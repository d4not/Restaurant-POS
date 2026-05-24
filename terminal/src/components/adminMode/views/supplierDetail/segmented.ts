// Pill-segment control styles for the Supplier Detail tabs and the Info tab's
// View/Edit toggle. Copied from the segmented control in PurchaseOrdersView
// (its modeBar/segment/segmentBtn/segmentBtnOn block) so this view doesn't
// reach into a sibling for styling. The PurchaseOrdersView copy stays put;
// promoting it to a shared module is a follow-up cleanup tracked in the plan.

import type { CSSProperties } from 'react';

export const segmentWrap: CSSProperties = {
  display: 'inline-flex',
  padding: 3,
  borderRadius: 999,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
};

export const segmentBtn: CSSProperties = {
  height: 34,
  padding: '0 16px',
  borderRadius: 999,
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--text2)',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 140ms cubic-bezier(0.22, 1, 0.36, 1)',
  minHeight: 34,
};

export const segmentBtnOn: CSSProperties = {
  height: 34,
  padding: '0 16px',
  borderRadius: 999,
  border: '1px solid var(--text1)',
  background: 'var(--text1)',
  color: '#f6efe2',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 140ms cubic-bezier(0.22, 1, 0.36, 1)',
  minHeight: 34,
};
