import type { SessionManager } from '../browser/sessionManager.js';
import { withDeadline } from './deadline.js';

export async function getPageSnapshot(
  sessions: SessionManager,
  id: string,
  maxItems = 20,
) {
  return sessions.use(id, async (session) => {
    const snapshot = await withDeadline(
      sessions,
      id,
      sessions.config.actionTimeoutMs,
      async () =>
        session.page.evaluate((limit) => {
          type Item = {
            name: string;
            selector: string | null;
            role: string;
            level?: number;
            href?: string;
            type?: string;
            disabled?: boolean;
            placeholder?: string;
          };
          const groups = {
            headings: [] as Item[],
            buttons: [] as Item[],
            links: [] as Item[],
            forms: [] as Item[],
            inputs: [] as Item[],
            landmarks: [] as Item[],
          };
          const truncated = new Set<string>();
          const visibleText: string[] = [];
          const seenText = new Set<string>();
          const hidden = new WeakMap<Element, boolean>();
          const clean = (value: string | null | undefined) =>
            (value ?? '')
              .slice(0, 2048)
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 200);
          const visible = (element: Element): boolean => {
            const style = getComputedStyle(element);
            const isHidden =
              Boolean(element.closest('[hidden],[aria-hidden="true"]')) ||
              style.display === 'none' ||
              style.visibility === 'hidden' ||
              style.visibility === 'collapse' ||
              style.opacity === '0' ||
              Boolean(
                element.parentElement && hidden.get(element.parentElement),
              );
            hidden.set(element, isHidden);
            return !isHidden && element.getClientRects().length > 0;
          };
          const textOf = (element: Element): string => {
            if (element.closest('input,textarea,select,[contenteditable]'))
              return '';
            const walker = document.createTreeWalker(
              element,
              NodeFilter.SHOW_TEXT,
            );
            let output = '';
            let scanned = 0;
            let node: Node | null;
            while (
              (node = walker.nextNode()) &&
              scanned++ < 32 &&
              output.length < 512
            ) {
              const parent = node.parentElement;
              if (
                !parent ||
                parent.closest(
                  'script,style,input,textarea,select,[contenteditable],[hidden],[aria-hidden="true"]',
                ) ||
                !visible(parent)
              )
                continue;
              output += ' ' + (node.textContent ?? '').slice(0, 512);
            }
            return clean(output);
          };
          const nameOf = (element: Element): string => {
            const aria = clean(element.getAttribute('aria-label'));
            if (aria) return aria;
            const labelled = clean(element.getAttribute('aria-labelledby'))
              .split(' ')
              .slice(0, 4)
              .map((label) => document.getElementById(label))
              .filter((item): item is HTMLElement => Boolean(item))
              .map(textOf)
              .join(' ');
            if (labelled) return clean(labelled);
            if (
              element instanceof HTMLInputElement ||
              element instanceof HTMLTextAreaElement ||
              element instanceof HTMLSelectElement
            ) {
              const labels = [...(element.labels ?? [])]
                .slice(0, 4)
                .map(textOf)
                .join(' ');
              return clean(
                labels ||
                  element.getAttribute('placeholder') ||
                  element.getAttribute('title'),
              );
            }
            return textOf(element) || clean(element.getAttribute('title'));
          };
          const selectorOf = (element: Element): string | null => {
            const parts: string[] = [];
            let current: Element | null = element;
            let budget = 512;
            while (current && parts.length < 32) {
              let index = 1;
              let sibling = current.previousElementSibling;
              while (sibling && budget-- > 0) {
                if (sibling.tagName === current.tagName) index++;
                sibling = sibling.previousElementSibling;
              }
              if (sibling) return null;
              parts.unshift(
                `${CSS.escape(current.tagName.toLowerCase())}:nth-of-type(${index})`,
              );
              current = current.parentElement;
            }
            return current ? null : parts.join(' > ');
          };
          const add = (group: keyof typeof groups, item: Item): void => {
            if (groups[group].length < limit) groups[group].push(item);
            else truncated.add(group);
          };
          const root = document.documentElement;
          const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_ELEMENT,
          );
          let element: Element | null = root;
          let scanned = 0;
          while (element && scanned < 5000) {
            scanned++;
            if (visible(element)) {
              const tag = element.tagName.toLowerCase();
              const explicitRole =
                clean(element.getAttribute('role')).split(' ')[0] ?? '';
              const role =
                explicitRole ||
                (tag === 'button'
                  ? 'button'
                  : tag === 'a'
                    ? 'link'
                    : /^h[1-6]$/.test(tag)
                      ? 'heading'
                      : tag);
              const isButton =
                role === 'button' ||
                (tag === 'input' &&
                  ['button', 'submit', 'reset'].includes(
                    (element.getAttribute('type') ?? '').toLowerCase(),
                  ));
              const isInput =
                (['input', 'textarea', 'select'].includes(tag) && !isButton) ||
                ['textbox', 'combobox', 'checkbox', 'radio', 'switch'].includes(
                  role,
                );
              const isLandmark =
                ['main', 'nav', 'aside', 'header', 'footer'].includes(tag) ||
                [
                  'main',
                  'navigation',
                  'complementary',
                  'banner',
                  'contentinfo',
                  'region',
                  'search',
                ].includes(role);
              if (
                role === 'heading' ||
                isButton ||
                role === 'link' ||
                tag === 'form' ||
                isInput ||
                isLandmark
              ) {
                const item: Item = {
                  name: nameOf(element),
                  selector: selectorOf(element),
                  role,
                };
                if (role === 'heading')
                  add('headings', {
                    ...item,
                    level:
                      Number(
                        element.getAttribute('aria-level') || tag.slice(1),
                      ) || 1,
                  });
                if (isButton)
                  add('buttons', {
                    ...item,
                    role: 'button',
                    disabled:
                      element.matches(':disabled') ||
                      element.getAttribute('aria-disabled') === 'true',
                  });
                if (role === 'link')
                  add('links', {
                    ...item,
                    href:
                      element instanceof HTMLAnchorElement
                        ? element.href
                        : clean(element.getAttribute('href')),
                  });
                if (tag === 'form') add('forms', item);
                if (isInput)
                  add('inputs', {
                    ...item,
                    type: clean(element.getAttribute('type') || tag),
                    placeholder: clean(element.getAttribute('placeholder')),
                    disabled:
                      element.matches(':disabled') ||
                      element.getAttribute('aria-disabled') === 'true',
                  });
                if (isLandmark) add('landmarks', item);
              }
              if (
                !element.closest(
                  'script,style,input,textarea,select,[contenteditable]',
                )
              ) {
                let childCount = 0;
                for (const child of element.childNodes) {
                  if (childCount++ === 16) break;
                  if (child.nodeType !== Node.TEXT_NODE) continue;
                  const text = clean(child.textContent);
                  if (text && !seenText.has(text)) {
                    seenText.add(text);
                    if (visibleText.length < limit) visibleText.push(text);
                    else truncated.add('visible_text');
                  }
                }
              }
            }
            element = walker.nextNode() as Element | null;
          }
          return {
            title: clean(document.title),
            ...groups,
            visible_text: visibleText,
            scanned_elements: scanned,
            scan_limit_reached: Boolean(element),
            truncated_categories: [...truncated],
          };
        }, maxItems),
    );
    // Redact known patterns outside the untrusted page execution context.
    const redact = <T>(value: T): T => {
      if (typeof value === 'string') return session.events.sanitize(value) as T;
      if (Array.isArray(value)) return value.map(redact) as T;
      if (value && typeof value === 'object')
        return Object.fromEntries(
          Object.entries(value).map(([key, entry]) => [
            key,
            ['selector', 'role', 'type', 'truncated_categories'].includes(key)
              ? entry
              : key === 'href' && typeof entry === 'string'
                ? session.events.sanitizeUrl(entry)
                : redact(entry),
          ]),
        ) as T;
      return value;
    };
    return {
      ...redact(snapshot),
      session_id: id,
      current_url: session.events.sanitizeUrl(session.page.url()),
      viewport: session.page.viewportSize(),
      content_trust: 'untrusted' as const,
    };
  });
}
