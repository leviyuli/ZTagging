/**
 * Native HTML select popups depend on browser chrome styles that are absent from
 * Zotero manager windows. Keep this control entirely in the HTML document.
 */
export type DropdownOptions = {
  id: string;
  value: string;
  choices: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
  disabled?: boolean;
};

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const openDropdowns = new WeakMap<Document, () => void>();

/** Call before replacing manager content, and when destroying its window. */
export function cleanupDropdowns(doc: Document): void {
  openDropdowns.get(doc)?.();
}

export function createDropdown(win: Window, options: DropdownOptions): HTMLButtonElement {
  const doc = win.document;
  const choices = [...options.choices];
  const trigger = doc.createElementNS(HTML_NAMESPACE, 'button') as HTMLButtonElement;
  const label = doc.createElementNS(HTML_NAMESPACE, 'span') as HTMLSpanElement;
  trigger.id = options.id;
  trigger.type = 'button';
  trigger.className = 'smart-tags-dropdown-trigger';
  trigger.disabled = Boolean(options.disabled) || choices.length === 0;
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', `${options.id}-listbox`);
  label.className = 'smart-tags-dropdown-label';
  trigger.append(label);

  let value = options.value;
  let activeIndex = -1;
  let popup: HTMLDivElement | null = null;
  let optionNodes: HTMLDivElement[] = [];
  let search = '';
  let searchTimer: number | undefined;

  function updateLabel(): void {
    label.textContent = choices.find(([key]) => key === value)?.[1] ?? value;
  }
  updateLabel();

  function contains(node: Node, target: EventTarget | null): boolean {
    return target !== null && typeof (target as Node).nodeType === 'number' && node.contains(target as Node);
  }

  function resetSearch(): void {
    if (searchTimer !== undefined) win.clearTimeout(searchTimer);
    searchTimer = undefined;
    search = '';
  }

  function close(restoreFocus = false): void {
    if (!popup) return;
    popup.remove();
    popup = null;
    optionNodes = [];
    activeIndex = -1;
    resetSearch();
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
    doc.removeEventListener('pointerdown', onOutsidePointer, true);
    doc.removeEventListener('focusin', onOutsideFocus);
    doc.removeEventListener('scroll', onScroll, true);
    win.removeEventListener('resize', onViewportChange);
    win.removeEventListener('unload', onViewportChange);
    if (openDropdowns.get(doc) === close) openDropdowns.delete(doc);
    if (restoreFocus && trigger.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
  }

  function onOutsidePointer(event: Event): void {
    if (!contains(trigger, event.target) && (!popup || !contains(popup, event.target))) close();
  }

  function onOutsideFocus(event: Event): void {
    if (!contains(trigger, event.target) && (!popup || !contains(popup, event.target))) close();
  }

  function onScroll(event: Event): void {
    // Scrolling the options themselves must not dismiss a long list.
    if (!popup || !contains(popup, event.target)) close();
  }

  function onViewportChange(): void {
    close();
  }

  function setActive(index: number, reveal = true): void {
    if (!popup || index < 0 || index >= choices.length) return;
    activeIndex = index;
    optionNodes.forEach((node, optionIndex) => node.setAttribute('data-active', String(optionIndex === index)));
    const option = optionNodes[index];
    trigger.setAttribute('aria-activedescendant', option.id);
    if (!reveal) return;
    // scrollIntoView also scrolls the manager, which would dismiss the popup.
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < popup.scrollTop) popup.scrollTop = top;
    else if (bottom > popup.scrollTop + popup.clientHeight) popup.scrollTop = bottom - popup.clientHeight;
  }

  function positionPopup(): void {
    if (!popup) return;
    const rect = trigger.getBoundingClientRect();
    const edge = 8;
    const gap = 4;
    const viewportWidth = win.innerWidth || doc.documentElement.clientWidth;
    const viewportHeight = win.innerHeight || doc.documentElement.clientHeight;
    const width = Math.min(rect.width, Math.max(1, viewportWidth - edge * 2));
    popup.style.width = `${width}px`;
    const desiredHeight = Math.min(popup.scrollHeight + 2, 320);
    const below = Math.max(0, viewportHeight - rect.bottom - gap - edge);
    const above = Math.max(0, rect.top - gap - edge);
    const openBelow = desiredHeight <= below || below >= above;
    const available = openBelow ? below : above;
    const height = Math.min(desiredHeight, Math.max(1, available));
    const left = Math.max(edge, Math.min(rect.left, viewportWidth - width - edge));
    const top = Math.max(edge, Math.min(
      openBelow ? rect.bottom + gap : rect.top - gap - height,
      viewportHeight - height - edge,
    ));
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.maxHeight = `${Math.min(320, Math.max(1, available))}px`;
    popup.style.visibility = 'visible';
  }

  function commit(index: number): void {
    const choice = choices[index];
    if (!popup || !choice || trigger.disabled) {
      close();
      return;
    }
    const changed = choice[0] !== value;
    value = choice[0];
    updateLabel();
    // The callback may synchronously rebuild the manager and remove the trigger.
    close(true);
    if (changed) options.onChange(value);
  }

  function open(fallbackIndex = 0): void {
    if (popup || trigger.disabled || !trigger.isConnected || !choices.length || !doc.body) return;
    cleanupDropdowns(doc);
    popup = doc.createElementNS(HTML_NAMESPACE, 'div') as HTMLDivElement;
    popup.id = `${options.id}-listbox`;
    popup.className = 'smart-tags-dropdown-menu';
    popup.setAttribute('role', 'listbox');
    popup.setAttribute('aria-labelledby', trigger.id);
    popup.style.visibility = 'hidden';
    optionNodes = choices.map(([key, text], index) => {
      const option = doc.createElementNS(HTML_NAMESPACE, 'div') as HTMLDivElement;
      option.id = `${options.id}-option-${index}`;
      option.className = 'smart-tags-dropdown-option';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(key === value));
      option.textContent = text;
      option.addEventListener('pointerdown', event => event.preventDefault());
      option.addEventListener('pointermove', () => setActive(index, false));
      option.addEventListener('click', () => commit(index));
      popup!.append(option);
      return option;
    });
    doc.body.append(popup);
    positionPopup();
    trigger.setAttribute('aria-expanded', 'true');
    openDropdowns.set(doc, close);
    doc.addEventListener('pointerdown', onOutsidePointer, true);
    doc.addEventListener('focusin', onOutsideFocus);
    doc.addEventListener('scroll', onScroll, true);
    win.addEventListener('resize', onViewportChange);
    win.addEventListener('unload', onViewportChange);
    trigger.focus({ preventScroll: true });
    const selectedIndex = choices.findIndex(([key]) => key === value);
    setActive(selectedIndex === -1 ? fallbackIndex : selectedIndex);
  }

  function typeahead(key: string): void {
    open();
    if (!popup) return;
    if (searchTimer !== undefined) win.clearTimeout(searchTimer);
    const character = key.toLocaleLowerCase();
    const repeating = search.length > 0 && [...search].every(letter => letter === character);
    search = repeating ? character : search + character;
    const start = search.length === 1 ? activeIndex + 1 : activeIndex;
    for (let offset = 0; offset < choices.length; offset++) {
      const index = (start + offset + choices.length) % choices.length;
      if (choices[index][1].toLocaleLowerCase().startsWith(search)) {
        setActive(index);
        break;
      }
    }
    searchTimer = win.setTimeout(resetSearch, 700);
  }

  trigger.addEventListener('click', () => {
    if (popup) close();
    else open();
  });

  trigger.addEventListener('keydown', event => {
    if (trigger.disabled) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!popup) open(event.key === 'ArrowUp' ? choices.length - 1 : 0);
        else setActive(Math.max(0, Math.min(choices.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1))));
        break;
      }
      case 'Home':
      case 'End':
        event.preventDefault();
        open();
        setActive(event.key === 'Home' ? 0 : choices.length - 1);
        break;
      case 'Enter':
      case ' ':
      case 'Spacebar':
        event.preventDefault();
        if (event.repeat) break;
        if (popup) commit(activeIndex);
        else open();
        break;
      case 'Escape':
        if (popup) {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        }
        break;
      case 'Tab':
        close();
        break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          typeahead(event.key);
        }
    }
  });

  return trigger;
}
