import type { LaunchRules } from './instructions';

const DAY = 86_400;

export interface Preset {
  id: string;
  name: string;
  line: string;
  rules: LaunchRules;
}

/** Launch presets shown on the launch page. Every one stays inside the program's bounds. */
export const PRESETS: readonly Preset[] = [
  {
    id: 'plain',
    name: 'Plain',
    line: 'No token rules. The creator earns 1% of every trade.',
    rules: { creatorFeeBps: 100, holderFeeBuyBps: 0, holderFeeSellBps: 0, burnBuyBps: 0, burnSellBps: 0, maxWalletBps: 0, creatorLockSecs: 0, earlyWindowSecs: 0, earlyLockSecs: 0 },
  },
  {
    id: 'diamond',
    name: 'Diamond hands',
    line: 'Holders earn 1% of every trade in SOL. Max wallet 1% until graduation, creator locked 90 days, first-minute buyers locked a day.',
    rules: { creatorFeeBps: 50, holderFeeBuyBps: 100, holderFeeSellBps: 100, burnBuyBps: 0, burnSellBps: 0, maxWalletBps: 100, creatorLockSecs: 90 * DAY, earlyWindowSecs: 60, earlyLockSecs: DAY },
  },
  {
    id: 'furnace',
    name: 'Furnace',
    line: 'Every trade burns 0.5% of the tokens and pays holders 0.5% in SOL.',
    rules: { creatorFeeBps: 50, holderFeeBuyBps: 50, holderFeeSellBps: 50, burnBuyBps: 50, burnSellBps: 50, maxWalletBps: 0, creatorLockSecs: 0, earlyWindowSecs: 0, earlyLockSecs: 0 },
  },
  {
    id: 'paid-to-hold',
    name: 'Paid to hold',
    line: 'Sellers pay holders 2% in SOL; buys pay nothing extra. Creator locked 30 days.',
    rules: { creatorFeeBps: 50, holderFeeBuyBps: 0, holderFeeSellBps: 200, burnBuyBps: 0, burnSellBps: 0, maxWalletBps: 0, creatorLockSecs: 30 * DAY, earlyWindowSecs: 0, earlyLockSecs: 0 },
  },
];
