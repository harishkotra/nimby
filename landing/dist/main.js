const story = document.querySelector('[data-story]');
const stage = story.querySelector('.story-pin');
const beats = Array.from(story.querySelectorAll('.beat'));
const panes = Array.from(story.querySelectorAll('[data-pane]'));
const controls = Array.from(story.querySelectorAll('.story-controls a'));
const appTabs = Array.from(story.querySelector('[data-app-tabs]').children);
const scanButton = story.querySelector('[data-scan-button]');
const scanCount = story.querySelector('[data-scan-count]');
const scanPercent = story.querySelector('[data-scan-percent]');
const scanFill = story.querySelector('[data-scan-fill]');
const recent = Array.from(story.querySelector('[data-recent]').children);
const keepLabel = story.querySelector('[data-keep-label]');
const keepIcon = story.querySelector('[data-keep-icon]');
const keepButton = story.querySelector('.keep-button');
const queryDisplay = story.querySelector('[data-query]');
const keyboard = story.querySelector('[data-keyboard]');
const header = document.querySelector('.topbar');
const mobile = matchMedia('(max-width: 760px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const sampleQuery = 'electricity bill';
const keys = new Map();

for (const row of ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']) {
  const rowElement = document.createElement('div');
  rowElement.className = 'key-row';
  for (const letter of row) {
    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = letter;
    rowElement.append(key);
    keys.set(letter, key);
  }
  keyboard.append(rowElement);
}

const lastRow = document.createElement('div');
lastRow.className = 'key-row';
const spaceKey = document.createElement('span');
spaceKey.className = 'key space-key';
spaceKey.textContent = 'English';
keys.set(' ', spaceKey);
const searchKey = document.createElement('span');
searchKey.className = 'key search-key';
searchKey.textContent = 'Search';
lastRow.append(spaceKey, searchKey);
keyboard.append(lastRow);

let currentScene = -1;
let previousKey;
let previousCount = -1;
let previousLength = -1;
let previousKeep;
let frame = 0;

const clamp = (value) => Math.max(0, Math.min(1, value));

function showScene(index) {
  if (index === currentScene) return;
  currentScene = index;
  story.dataset.scene = String(index);
  panes.forEach((pane, i) => {
    pane.classList.toggle('current', i === index);
    pane.classList.toggle('before', i < index);
  });
  controls.forEach((control, i) => {
    if (i === index) control.setAttribute('aria-current', 'step');
    else control.removeAttribute('aria-current');
  });
  appTabs[0].classList.toggle('selected', index === 0);
  appTabs[1].classList.toggle('selected', index === 1 || index === 2);
}

function showScan(progress) {
  const count = Math.round(128 * progress);
  if (count === previousCount) return;
  previousCount = count;
  scanCount.textContent = String(count);
  scanPercent.textContent = Math.round(100 * progress) + '%';
  scanFill.style.transform = 'scaleX(' + progress + ')';
  scanButton.textContent = count === 128 ? 'Scan complete' : count > 0 ? 'Scanning photos…' : 'Scan gallery';
  recent.forEach((photo, index) => {
    photo.style.opacity = String(clamp(progress * 4 - index - .45));
  });
}

function showQuery(progress) {
  const length = Math.floor(sampleQuery.length * progress);
  if (length === previousLength) return;
  previousLength = length;
  queryDisplay.textContent = sampleQuery.slice(0, length);
  previousKey?.classList.remove('active');
  previousKey = keys.get(sampleQuery[length - 1]);
  previousKey?.classList.add('active');
}

function showKeep(kept) {
  if (kept === previousKeep) return;
  previousKeep = kept;
  keepLabel.textContent = kept ? 'Kept' : 'Keep';
  keepButton.classList.toggle('kept', kept);
  keepIcon.classList.toggle('icon-bookmark', !kept);
  keepIcon.classList.toggle('icon-check', kept);
}

function renderScroll() {
  frame = 0;
  const screenHeight = document.documentElement.clientHeight;
  const marker = mobile.matches
    ? header.offsetHeight + stage.offsetHeight + Math.max(44, (screenHeight - header.offsetHeight - stage.offsetHeight) * .42)
    : screenHeight * .55;
  const positions = beats.map((beat) => beat.getBoundingClientRect());
  const next = positions.findIndex(({ bottom }) => bottom > marker);
  const active = next === -1 ? beats.length - 1 : next;
  const { top, height } = positions[active];
  const progress = clamp((marker - top) / height);
  const quiet = reducedMotion.matches;

  showScene(active);

  if (active === 0) showScan(quiet ? 1 : clamp((progress - .16) / .55));
  if (active === 1) showQuery(quiet ? 1 : clamp((progress - .14) / .58));
  if (active === 3) showKeep(quiet || progress >= .57);
}

function scheduleRender() {
  if (!frame) frame = requestAnimationFrame(renderScroll);
}

window.addEventListener('scroll', scheduleRender, { passive: true });
window.addEventListener('resize', scheduleRender);
window.addEventListener('pageshow', scheduleRender);
reducedMotion.addEventListener('change', scheduleRender);
renderScroll();

function embedWaitlist(shareUrl) {
  let url;
  try {
    url = new URL(shareUrl);
  } catch {
    return;
  }
  const match = url.pathname.match(/^\/(?:r|embed)\/([a-z0-9]+)\/?$/i);
  if (url.origin !== 'https://tally.so' || !match || url.username || url.password) return;

  const id = match[1];
  const embed = document.querySelector('[data-waitlist-embed]');
  const frame = embed.querySelector('iframe');
  frame.src = 'https://tally.so/embed/' + id + '?hideTitle=1&transparentBackground=1&dynamicHeight=1';
  embed.hidden = false;
  document.querySelector('[data-waitlist-status]').hidden = true;

  const widget = document.createElement('script');
  widget.src = 'https://tally.so/widgets/embed.js';
  widget.async = true;
  document.head.append(widget);
}

embedWaitlist(window.NIMBY_TALLY_URL);
