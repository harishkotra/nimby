import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, PermissionsAndroid, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActionMenu, ActionSheet } from './ActionSheet';
import { useDialog } from './Dialogs';
import { native, type FollowUpAction, type Result } from './gallery';
import { dateInput, localDate, receiptFacts, receiptSuggestion, type ReceiptSuggestion, relatedShopping, reminderDate, shoppingFacts, type NextStepKind, type NextStepPhoto } from './nextStepFacts';
import { PhotoTile } from './PhotoGrid';
import { ProductSearchSheet } from './ProductSearchSheet';
import { licenseDemo } from './demoConfig';
import { ReadingStatus } from './ReadingStatus';
import { ActionLink, Body, Button, color, EmptyState, ErrorText, Heading, Segments, styles } from './ui';

const sections = [{ value: 'shopping', label: 'Shopping' }, { value: 'receipt', label: 'Receipts' }] as const;
function details(item: NextStepPhoto) {
  const captured = item.captured ? new Date(item.captured).toLocaleDateString() : null;
  if (item.kind === 'shopping') {
    const facts = shoppingFacts(item.text);
    return { title: facts.label ?? 'Saved product', caption: facts.price ? `${facts.price} shown in screenshot` : captured };
  }
  const facts = receiptFacts(item.text);
  return { title: 'Saved receipt', caption: [facts.total && `${facts.total} shown as total`, captured].filter(Boolean).join(' · ') };
}

async function requestNotifications() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true;
  return await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS) === PermissionsAndroid.RESULTS.GRANTED;
}

export function NextStepsScreen({ revision, target, scanning, open, changed }: {
  revision: number; target: string | null; scanning: boolean; open: (photo: Result) => void; changed: () => void;
}) {
  const show = useDialog();
  const [items, setItems] = useState<NextStepPhoto[]>([]);
  const [kind, setKind] = useState<NextStepKind>('shopping');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const [reminder, setReminder] = useState<NextStepPhoto | null>(null);
  const [searchProduct, setSearchProduct] = useState<NextStepPhoto | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [model, setModel] = useState(() => native?.productVisionStatus?.());
  const [notifications, setNotifications] = useState(() => native?.nextStepNotificationStatus?.());
  const [options, setOptions] = useState(false);
  const [proposal, setProposal] = useState<{ id: string; action: ReceiptSuggestion | null } | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [message, setMessage] = useState('');
  const refreshModel = useCallback(() => setModel(native?.productVisionStatus?.()), []);
  const refreshNotifications = () => setNotifications(native?.nextStepNotificationStatus?.());
  const initialized = useRef(false);
  const handledTarget = useRef<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    native?.nextSteps?.(target).then((results) => {
      if (!current) return;
      setItems(results);
      if (target && target !== handledTarget.current) {
        handledTarget.current = target;
        const requested = results.find((item) => item.photo.id === target);
        setComparing(false);
        setSelection(null);
        if (requested) { setKind(requested.kind); setActiveId(requested.photo.id); }
        else setMessage('That photo is no longer available for follow-up.');
      } else if (!initialized.current && !results.some((item) => item.kind === 'shopping') && results.length) {
        setKind('receipt');
      }
      initialized.current = true;
    }).catch(() => { if (current) setError('Could not load saved photos.'); })
      .finally(() => { if (current) setLoading(false); });
    refreshNotifications();
    return () => { current = false; };
  }, [revision, retry, target]);

  if (!native?.nextSteps) return <View style={styles.content}>
    <Heading large>Shopping &amp; receipts</Heading><Body>Install the updated Android build to use shopping and receipt follow-ups.</Body>
  </View>;

  const scoped = items.filter((item) => item.kind === kind);
  const active = scoped.find((item) => item.photo.id === activeId);
  const related = active?.kind === 'shopping' ? relatedShopping(active, items) : [];
  const selected = scoped.filter(({ photo }) => selection?.includes(photo.id));
  const scheduledDate = reminderDate(date, time);

  function select(next: NextStepKind) {
    setKind(next);
    setActiveId(null);
    setSelection(null);
    setComparing(false);
    setMessage('');
    setError('');
  }

  function startReminder(item: NextStepPhoto) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const found = item.kind === 'receipt' ? receiptFacts(item.text).returnBy : null;
    const proposed = found ? localDate(found) : null;
    const previous = item.due > Date.now() ? new Date(item.due) : null;
    setDate(dateInput(previous ?? (proposed && proposed.getTime() > Date.now() ? proposed : tomorrow)));
    setTime(previous ? `${String(previous.getHours()).padStart(2, '0')}:${String(previous.getMinutes()).padStart(2, '0')}` : '09:00');
    setError('');
    setReminder(item);
  }

  async function save(item: NextStepPhoto, action: FollowUpAction, due = 0) {
    setBusy(true);
    setError('');
    try {
      if (action === 'schedule' && !(await requestNotifications())) {
        setError('Allow Nimby notifications in Android settings to set a reminder.');
        return;
      }
      await native?.savePhotoFollowUp?.(item.photo.id, action, due);
      setReminder(null);
      if (action === 'done' || action === 'dismissed' || action === 'file') setActiveId(null);
      setMessage(action === 'schedule' ? 'Reminder saved.' : action === 'cancel' ? 'Reminder canceled.' :
        action === 'file' ? 'Saved in Kept photos under Reimbursements.' : action === 'done' ? 'Follow-up marked complete.' : 'Suggestion dismissed.');
      changed();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the follow-up.'); }
    finally { setBusy(false); }
  }

  async function setShoppingNotifications(next: boolean) {
    setBusy(true);
    setError('');
    try {
      if (next && !(await requestNotifications())) { setError('Allow Nimby notifications in Android settings first.'); return; }
      await native?.setShoppingNotifications?.(next);
      refreshNotifications();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update shopping notifications.'); }
    finally { setBusy(false); }
  }

  async function ask(item: NextStepPhoto) {
    if (asking || !native?.reviewReceiptImage) return;
    setAsking(item.photo.id);
    setProposal(null);
    setError('');
    try {
      const dateFromPhoto = localDate(receiptFacts(item.text).returnBy ?? '');
      const answer = await native.reviewReceiptImage(item.photo.id);
      setProposal({ id: item.photo.id, action: receiptSuggestion(answer, Boolean(dateFromPhoto && dateFromPhoto.getTime() > Date.now())) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not review this receipt with Qwen.'); }
    finally { setAsking(null); refreshModel(); }
  }

  function toggle(id: string) {
    setSelection((current) => current?.includes(id) ? current.filter((key) => key !== id) : [...(current ?? []), id].slice(0, 4));
  }

  function openListing(item: NextStepPhoto) {
    if (licenseDemo) return;
    const saved = shoppingFacts(item.text).url;
    if (!saved) return;
    show({ title: 'Open link from screenshot?', message: `Open ${saved.host} in your browser? Confirm the address there before buying.`,
      action: { label: 'Open saved link', run: () => { void Linking.openURL(saved.url).catch(() => setError('Could not open the saved link.')); } } });
  }

  function fileReceipt(item: NextStepPhoto) {
    const previous = item.photo.collection;
    if (!previous || previous === 'Reimbursements') {
      void save(item, 'file');
      return;
    }
    show({ title: 'Move receipt to Reimbursements?', message: `This changes its Nimby collection from “${previous}” to “Reimbursements”.`,
      action: { label: 'Move receipt', run: () => void save(item, 'file') } });
  }

  const reminderReceipt = reminder?.kind === 'receipt' ? receiptFacts(reminder.text) : null;

  return <View style={layout.fill}>
    <FlatList key={comparing ? 'comparison' : kind} data={comparing ? selected : scoped} keyExtractor={(item) => item.photo.id}
      numColumns={comparing ? 2 : 1} columnWrapperStyle={comparing ? layout.compareRow : undefined}
      contentContainerStyle={styles.content} ListHeaderComponent={<View style={styles.column}>
        <View style={styles.between}>
          <Heading large>{comparing ? 'Compare options' : 'Shopping & receipts'}</Heading>
          {comparing ? <ActionLink label="Done comparing" run={() => setComparing(false)} /> : notifications &&
            <ActionLink label={options ? 'Close notifications' : 'Notifications'} run={() => setOptions(!options)} />}
        </View>
        {comparing ? <Body>Prices and names come from the saved screenshots. Open each image to verify details.</Body> : <>
          <Segments options={sections} value={kind} select={select} />
          {options && notifications && <View style={layout.panel}>
            <Heading>Shopping notifications</Heading>
            <Body>{notifications.shopping ? notifications.shoppingAvailable ? 'On · at most one notification a week for new shopping references' :
              'Paused by Android notification settings' :
              'Off · shopping suggestions still appear in Nimby'}</Body>
            <ActionLink label={notifications.shopping ? 'Turn off shopping notifications' : 'Enable shopping notifications'}
              disabled={busy} run={() => void setShoppingNotifications(!notifications.shopping)} />
          </View>}
          <View style={styles.between}>
            <Body>{selection ? `${selection.length} of 4 selected` : kind === 'shopping' ? 'Saved products to revisit' : 'Receipts to file or follow up'}</Body>
            {kind === 'shopping' && scoped.length >= 2 && <ActionLink label={selection ? 'Cancel selection' : 'Select to compare'}
              run={() => { setActiveId(null); setSelection(selection ? null : []); }} />}
          </View>
        </>}
        {!!message && <Text accessibilityLiveRegion="polite" style={styles.body}>{message}</Text>}
        {!!error && !reminder && <ErrorText>{error}</ErrorText>}
      </View>}
      ListEmptyComponent={loading ? <ActivityIndicator accessibilityLabel="Loading next steps" color={color.blue} /> :
        <EmptyState icon="image" title={kind === 'shopping' ? 'No saved products yet' : 'No receipts yet'}
          text="Scan more photos to find items you can review here."
          action={error ? <ActionLink label="Try again" run={() => setRetry(retry + 1)} /> : undefined} />}
      renderItem={({ item }) => {
        const info = details(item);
        const expanded = !selection && active?.photo.id === item.photo.id;
        if (comparing) return <View style={layout.compareTile}>
          <PhotoTile uri={item.photo.uri} label={`Open ${info.title}`} contain ratio={0.85} press={() => open(item.photo)} />
          <Heading>{info.title}</Heading>{!!info.caption && <Body>{info.caption}</Body>}
          {!licenseDemo && <ActionLink label="Find buying links" run={() => setSearchProduct(item)} />}
        </View>;
        return <View style={layout.panel}>
          <View style={layout.photoRow}>
            <View style={layout.thumb}>
              <PhotoTile uri={item.photo.uri} label={`${selection ? 'Select' : 'Open'} ${info.title}`}
                selected={selection ? selection.includes(item.photo.id) : undefined}
                press={() => selection ? toggle(item.photo.id) : open(item.photo)} />
            </View>
            <View style={layout.fill}>
              <Heading>{info.title}</Heading>{!!info.caption && <Body>{info.caption}</Body>}
              {item.state && <Body>{item.state === 'delivered' ? 'Reminder delivered' : `Reminder · ${new Date(item.due).toLocaleDateString()}`}</Body>}
            </View>
          </View>
          {!selection && <ActionLink label={expanded ? 'Close follow-up' : 'Review next steps'}
            run={() => { setActiveId(expanded ? null : item.photo.id); setError(''); }} />}
          {expanded && <View style={styles.column}>
            {item.kind === 'shopping' ? !licenseDemo && <Button label="Find buying links" icon="search" run={() => setSearchProduct(item)} /> :
              <Button label={item.state ? 'Change reminder' :
              item.kind === 'receipt' && receiptFacts(item.text).returnBy ? 'Set return reminder' : 'Set reminder'} run={() => startReminder(item)} />}
            <View style={layout.followUpActions}>
              {item.kind === 'shopping' && related.length > 0 && <ActionLink label={`Compare ${related.length + 1} saved options`} run={() => {
                setSelection([item.photo.id, ...related.map(({ photo }) => photo.id)]);
                setComparing(true);
              }} />}
              <ActionMenu title="Follow-up actions" label="More actions" disabled={busy} options={[
                ...(item.kind === 'shopping' ? [{ label: item.state ? 'Change reminder' : 'Set reminder', run: () => startReminder(item) }] : []),
                ...(item.state ? [{ label: 'Cancel reminder', run: () => void save(item, 'cancel') }] : []),
                ...(item.kind === 'receipt' ? [
                  ...(model?.installed && native?.reviewReceiptImage && !asking && !scanning ?
                    [{ label: 'Review with Qwen', run: () => void ask(item) }] : []),
                  { label: 'Keep for reimbursement', run: () => fileReceipt(item) },
                  { label: 'Mark follow-up complete', run: () => void save(item, 'done') },
                ] : []),
                ...(!licenseDemo && item.kind === 'shopping' && shoppingFacts(item.text).url ? [{ label: 'Open saved link', run: () => openListing(item) }] : []),
                { label: 'Dismiss suggestion', run: () => void save(item, 'dismissed') },
              ]} />
            </View>
            {asking === item.photo.id && <ReadingStatus label="Qwen is reading this receipt on your phone" />}
            {proposal?.id === item.photo.id && <View style={layout.suggestion}>
              <Body>{proposal.action === 'return_reminder' ? 'Qwen suggests a reminder for the return deadline shown on this receipt.' :
                proposal.action === 'review_receipt' ? 'Qwen suggests reviewing this receipt for reimbursement.' :
                'Qwen didn’t find a follow-up to suggest.'}</Body>
              {proposal.action === 'return_reminder' && <ActionLink label="Review return reminder" run={() => startReminder(item)} />}
              {proposal.action === 'review_receipt' && <ActionLink label="Keep for reimbursement" run={() => fileReceipt(item)} />}
            </View>}
          </View>}
        </View>;
      }} />
    {selection && !comparing && selected.length >= 2 && <View style={layout.footer}>
      <Button label={`Compare ${selected.length} photos`} run={() => setComparing(true)} />
    </View>}
    {reminder && <ActionSheet title="Set a reminder" close={() => { if (!busy) { setReminder(null); setError(''); } }}
      footer={<Button label={busy ? 'Saving…' : 'Save reminder'} disabled={busy || !scheduledDate || scheduledDate.getTime() <= Date.now()}
        run={() => { if (scheduledDate) void save(reminder, 'schedule', scheduledDate.getTime()); }} />}>
      <View style={styles.column}>
        {reminderReceipt?.returnBy && <Body>Return deadline read from the photo · {reminderReceipt.returnBy}. Confirm it against the original.</Body>}
        <Body>Choose a date and time. Android may deliver the reminder later.</Body>
        <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={color.muted}
          accessibilityLabel="Reminder date, year month day" maxLength={10} style={layout.input} />
        <TextInput value={time} onChangeText={setTime} placeholder="HH:MM" placeholderTextColor={color.muted}
          accessibilityLabel="Reminder time in 24-hour format" maxLength={5} style={layout.input} />
        {!!date && (!scheduledDate || scheduledDate.getTime() <= Date.now()) && <ErrorText>Enter a future date and time as YYYY-MM-DD and HH:MM.</ErrorText>}
        {!!error && <ErrorText>{error}</ErrorText>}
      </View>
    </ActionSheet>}
    {!licenseDemo && searchProduct && <ProductSearchSheet key={searchProduct.photo.id} imageId={searchProduct.photo.id}
      screenshotText={searchProduct.text} close={() => { setSearchProduct(null); refreshModel(); }} />}
  </View>;
}

const layout = StyleSheet.create({
  fill: { flex: 1 },
  panel: { backgroundColor: color.white, borderRadius: 16, padding: 16, gap: 8 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 72 },
  followUpActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 20 },
  suggestion: { gap: 4 },
  compareRow: { gap: 12 },
  compareTile: { flex: 1, gap: 8 },
  footer: { paddingHorizontal: 20, paddingVertical: 12, backgroundColor: color.paper },
  input: { color: color.ink, backgroundColor: color.paper, borderRadius: 12, minHeight: 48, paddingHorizontal: 12 },
});
