const dodoSandbox = 'https://test.dodopayments.com';
export const checkInterval = 24 * 60 * 60 * 1000;
export const offlineGrace = 7 * checkInterval;

type StoredLicense = {
  key: string;
  instanceId: string;
  productId: string;
  verifiedAt: number | null;
  lastAutomaticCheckAt: number | null;
};

type Dependencies = {
  productId: string;
  read: () => Promise<string | null>;
  write: (value: string | null) => Promise<void>;
  fetch: typeof fetch;
  now: () => number;
};

export type LicenseView = {
  status: 'loading' | 'free' | 'active' | 'verify';
  busy: boolean;
  hasActivation: boolean;
  expiresAt: number | null;
  message: string;
};

class DodoError extends Error {
  readonly status: number;
  constructor(status: number) {
    super('Dodo request failed');
    this.status = status;
  }
}

function readRecord(value: string | null, productId: string): StoredLicense | null {
  if (!value) return null;
  const record = JSON.parse(value) as Partial<StoredLicense> | null;
  if (record?.productId !== productId) return null;
  if (typeof record.key !== 'string' || !record.key || typeof record.instanceId !== 'string' ||
      !/^lki_[a-zA-Z0-9]+$/.test(record.instanceId) ||
      (record.verifiedAt !== null && !Number.isSafeInteger(record.verifiedAt)) ||
      (record.lastAutomaticCheckAt !== null && !Number.isSafeInteger(record.lastAutomaticCheckAt))) {
    throw new Error('Invalid local license record');
  }
  return record as StoredLicense;
}

export class LifetimeLicense {
  private readonly dependencies: Dependencies;
  private record: StoredLicense | null = null;
  private loaded = false;
  private busy = false;
  private message = '';
  private listener: (() => void) | null = null;

  constructor(dependencies: Dependencies) { this.dependencies = dependencies; }

  subscribe(listener: () => void) {
    this.listener = listener;
    return () => { this.listener = null; };
  }

  view(): LicenseView {
    const verifiedAt = this.record?.verifiedAt;
    const expiresAt = verifiedAt == null ? null : verifiedAt + offlineGrace;
    const now = this.dependencies.now();
    const active = verifiedAt != null && now >= verifiedAt && now < verifiedAt + offlineGrace;
    return {
      status: !this.loaded ? 'loading' : active ? 'active' : this.record ? 'verify' : 'free',
      busy: this.busy,
      hasActivation: this.record !== null,
      expiresAt,
      message: this.message,
    };
  }

  async foreground() {
    // Re-evaluate the grace window even when a refresh is throttled.
    this.listener?.();
    if (this.busy) return;
    if (!this.loaded) {
      await this.run(async () => {
        this.record = readRecord(await this.dependencies.read(), this.dependencies.productId);
        this.loaded = true;
      }, 'Could not open license storage. Try again.');
    }
    await this.check(true);
  }

  async redeem(input: string) {
    if (!this.loaded || this.busy || this.record) return;
    const key = input.trim();
    if (!key || key.length > 256) return;
    let activationRecorded = false;
    await this.run(async () => {
      const name = 'Nimby Android ' + this.dependencies.now().toString(36);
      const activation = await this.post('activate', { license_key: key, name });
      if (typeof activation?.id !== 'string' || !/^lki_[a-zA-Z0-9]+$/.test(activation.id)) {
        throw new Error('Invalid activation response');
      }
      const instance = { license_key: key, license_key_instance_id: activation.id };
      if (activation.product?.product_id !== this.dependencies.productId) {
        try { await this.post('deactivate', instance); } catch { /* The seller can release this slot. */ }
        this.message = 'This key is for a different product.';
        return;
      }
      const record = {
        key, instanceId: activation.id, productId: this.dependencies.productId, verifiedAt: null, lastAutomaticCheckAt: null,
      };
      // Keep the pending instance available for validation even if the secure write fails.
      this.record = record;
      activationRecorded = true;
      await this.save(record);
      await this.validate(record);
    }, (error) => {
      if (activationRecorded) return 'Use Check license to finish verifying this activation.';
      if (error instanceof DodoError) {
        if (error.status === 422) return 'This key has no available activation. Release the old device or ask support to reset it.';
        if (error.status === 403 || error.status === 404) return 'This license key is invalid or inactive.';
      }
      return 'Could not confirm activation. Check your connection. If the slot was used, ask support to reset it.';
    });
  }

  async check(automatic = false) {
    if (!this.loaded || this.busy || !this.record) return;
    const now = this.dependencies.now();
    const record = this.record;
    if (automatic && [record.verifiedAt, record.lastAutomaticCheckAt].some(
      (timestamp) => timestamp != null && now >= timestamp && now - timestamp < checkInterval,
    )) return;
    await this.run(async () => {
      const verify = automatic ? { ...record, lastAutomaticCheckAt: now } : record;
      if (automatic) await this.save(verify);
      await this.validate(verify);
    }, automatic ? '' : 'Could not verify the license. Check your connection and try again.');
  }

  async release() {
    if (!this.loaded || this.busy || !this.record) return;
    const record = this.record;
    let released = false;
    await this.run(async () => {
      await this.post('deactivate', this.instance(record));
      released = true;
      this.record = null;
      await this.save(null);
      this.message = 'This device was released.';
    }, () => released ? 'This device was released. Local license storage could not be cleared.' :
      'Could not confirm release. Check your license before trying again.');
  }

  private async validate(record: StoredLicense) {
    const result = await this.post('validate', this.instance(record));
    if (typeof result?.valid !== 'boolean') throw new Error('Invalid validation response');
    const updated = { ...record, verifiedAt: result.valid ? this.dependencies.now() : null };
    if (!result.valid) this.record = updated;
    await this.save(updated);
    if (!result.valid) this.message = 'This license or device activation is no longer valid.';
  }

  private instance(record: StoredLicense) {
    return { license_key: record.key, license_key_instance_id: record.instanceId };
  }

  private async save(record: StoredLicense | null) {
    await this.dependencies.write(record ? JSON.stringify(record) : null);
    this.record = record;
  }

  private async post(action: 'activate' | 'validate' | 'deactivate', body: Record<string, string>) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await this.dependencies.fetch(dodoSandbox + '/licenses/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new DodoError(response.status);
      // Consume the response under the same timeout. Deactivation has no body.
      return action === 'deactivate' ? null : await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async run(task: () => Promise<void>, errorMessage: string | ((error: unknown) => string)) {
    this.busy = true;
    this.message = '';
    this.listener?.();
    try {
      await task();
    } catch (error) {
      this.message = typeof errorMessage === 'function' ? errorMessage(error) : errorMessage;
    } finally {
      this.busy = false;
      this.listener?.();
    }
  }
}
