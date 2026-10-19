/**
 * Token status registry (machine-readable mirror of tokens.css for the Design
 * tokens page and token tests). LOCKED = from the master specification;
 * PROPOSED = filled gap, awaiting design approval.
 */
export type TokenStatus = 'locked' | 'locked-range' | 'proposed' | 'derived';

export interface TokenEntry {
  name: string;
  cssVar: string;
  value: string;
  status: TokenStatus;
  note?: string;
}

export const tokenRegistry: TokenEntry[] = [
  { name: 'Icon rail width', cssVar: '--uab-rail-width', value: '60px', status: 'locked-range', note: '56–64px' },
  { name: 'Context sidebar default', cssVar: '--uab-sidebar-width-default', value: '240px', status: 'locked' },
  { name: 'Sidebar min / max', cssVar: '--uab-sidebar-min', value: '200px / 360px', status: 'proposed' },
  { name: 'Navigation row', cssVar: '--uab-nav-row-h', value: '34px', status: 'locked' },
  { name: 'Navigation row gap', cssVar: '--uab-nav-row-gap', value: '2px', status: 'locked' },
  { name: 'Navigation label size', cssVar: '--uab-nav-font-size', value: '13px', status: 'locked' },
  { name: 'Section label size', cssVar: '--uab-section-font-size', value: '12px', status: 'locked' },
  { name: 'View bar height', cssVar: '--uab-view-tab-h', value: '40px', status: 'locked-range', note: '38–42px, underline' },
  { name: 'Inspector width', cssVar: '--uab-inspector-width', value: '480px', status: 'locked' },
  { name: 'Inspector expanded', cssVar: '--uab-inspector-width-expanded', value: '720px', status: 'locked-range', note: '680–760px' },
  { name: 'Control height', cssVar: '--uab-control-h', value: '40px', status: 'locked' },
  { name: 'Compact control height', cssVar: '--c-control-h-compact', value: '32px (spec 36px)', status: 'proposed', note: 'Owner override: all buttons & compact inputs' },
  { name: 'Touch control height', cssVar: '--uab-control-h-touch', value: '44px', status: 'locked' },
  { name: 'Control radius', cssVar: '--uab-radius-control', value: '7px', status: 'locked' },
  { name: 'Panel radius', cssVar: '--uab-radius-panel', value: '12px', status: 'locked' },
  { name: 'Dialog radius', cssVar: '--uab-radius-dialog', value: '14px', status: 'locked' },
  { name: 'Icon size', cssVar: '--uab-icon-size', value: '16px', status: 'locked' },
  { name: 'Rail Soft Charcoal', cssVar: '--uab-rail-charcoal-bg', value: '#24252D', status: 'locked' },
  { name: 'Rail Charcoal icon', cssVar: '--uab-rail-charcoal-icon', value: '#AAAAB7', status: 'locked' },
  { name: 'Rail Charcoal selected', cssVar: '--uab-rail-charcoal-selected-bg', value: '#3B354F', status: 'locked' },
  { name: 'Rail Charcoal selected icon', cssVar: '--uab-rail-charcoal-selected-icon', value: '#CFBFFF', status: 'locked' },
  { name: 'Rail Midnight Navy', cssVar: '--uab-rail-navy-bg', value: '#1C2535', status: 'locked' },
  { name: 'Rail Graphite Black', cssVar: '--uab-rail-black-bg', value: '#15161A', status: 'locked' },
  { name: 'Rail Soft Light', cssVar: '--c-rail-bg', value: '#ECECF1', status: 'proposed', note: 'Spec marks unresolved' },
  { name: 'Spacing base', cssVar: '--sp-1', value: '4px', status: 'proposed' },
  { name: 'Text — primary', cssVar: '--fs-primary', value: '18px', status: 'proposed', note: 'Owner rule: page & record titles' },
  { name: 'Text — secondary', cssVar: '--fs-secondary', value: '16px', status: 'proposed', note: 'Owner rule: section/panel/dialog titles, key numbers' },
  { name: 'Text — supportive', cssVar: '--fs-supportive', value: '13px', status: 'proposed', note: 'Owner rule: everything else (tables, buttons, inputs, nav)' },
  { name: 'Font family', cssVar: '--font-sans', value: 'system-ui stack', status: 'proposed', note: 'No font files distributed' },
  { name: 'Accent', cssVar: '--s-accent', value: '#5B47C7 / #A895FF dark', status: 'proposed' },
  { name: 'Breakpoints', cssVar: '—', value: '1100px (tablet), 760px (phone)', status: 'proposed' },
];

export const railSkins = [
  { id: 'softCharcoal', label: 'Soft Charcoal', swatch: '#24252D' },
  { id: 'midnightNavy', label: 'Midnight Navy', swatch: '#1C2535' },
  { id: 'graphiteBlack', label: 'Graphite Black', swatch: '#15161A' },
  { id: 'softLight', label: 'Soft Light', swatch: '#ECECF1' },
] as const;
