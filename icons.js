// Small line icons for the "who gets the $100" rows. Drawn on a 24x24 grid in currentColor.

const svg = (body) =>
  `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  // A storefront with an awning.
  other: svg(
    '<path d="M4 10v10h16V10"/><path d="M3 10l1.5-6h15L21 10"/><path d="M3 10a3 3 0 0 0 6 0a3 3 0 0 0 6 0a3 3 0 0 0 6 0"/><path d="M10 20v-5h4v5"/>',
  ),
  // A worker in a hard hat.
  workers: svg(
    '<path d="M6.5 10a5.5 5.5 0 0 1 11 0"/><path d="M5 10h14"/><path d="M12 4.5v2.5"/><path d="M7.5 11.5a4.5 4.5 0 0 0 9 0"/><path d="M5 21a7 7 0 0 1 14 0"/>',
  ),
  // A government building with columns.
  governments: svg(
    '<path d="M3 9.5L12 4l9 5.5z"/><path d="M5 9.5v8M9.5 9.5v8M14.5 9.5v8M19 9.5v8"/><path d="M3 17.5h18M2 21h20"/>',
  ),
  // A tycoon: top hat, monocle and moustache.
  owners: svg(
    '<path d="M8 2.5h8v6H8z"/><path d="M8 7h8"/><path d="M4.5 8.5h15"/><path d="M6.8 11a5.5 5.5 0 1 0 10.4 0"/><circle cx="9.6" cy="12.6" r=".5" fill="currentColor"/><circle cx="14.4" cy="12.6" r="1.7"/><path d="M15.6 13.9q2.2 2.6 1.4 6"/><path d="M8.6 16.6q1.6.9 3.4-.4q1.8 1.3 3.4.4"/>',
  ),
  // A safe with a dial.
  kept: svg(
    '<rect x="3.5" y="4" width="17" height="15" rx="2"/><circle cx="12" cy="11.5" r="3.5"/><path d="M12 8v1.5M12 13.5V15M8.5 11.5H10M14 11.5h1.5"/><path d="M6.5 19v2M17.5 19v2"/>',
  ),
  // A person in a suit and tie, for the CEO.
  ceo: svg(
    '<circle cx="12" cy="7" r="3.5"/><path d="M5 21a7 7 0 0 1 14 0"/><path d="M12 14l-1.2 2.2L12 21l1.2-4.8z"/>',
  ),
};
