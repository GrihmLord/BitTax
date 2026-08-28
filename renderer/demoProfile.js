/**
 * demoProfile.js
 * The sample dataset behind "Load demo profile".
 *
 * This is fixture data for a documented product feature, kept in one clearly
 * named module so it can never be mistaken for a live source. The UI shows a
 * persistent banner whenever it is loaded, and the key it fills in is an
 * obvious placeholder rather than a plausible-looking extended key.
 *
 * The set is chosen to exercise every branch worth showing: a wash sale, a
 * long-term disposal, a short-term disposal, a CoinJoin-flagged sale and a
 * Lightning channel open.
 */

export const DEMO_KEY_PLACEHOLDER = 'DEMO PROFILE — not a real key';

export const DEMO_MARK_PRICES = Object.freeze({ BTC: '45000', ETH: '2500' });

export const DEMO_HISTORY = Object.freeze({
    BTC: Object.freeze([
        { id: 'demo-btc-01', type: 'BUY', date: '2023-01-15', amount: '1.0', price: '21000', fee: '50' },
        // Sold at a loss, then repurchased 10 days later: the wash sale case.
        { id: 'demo-btc-02', type: 'SELL', date: '2023-01-20', amount: '1.0', price: '18000', fee: '20' },
        { id: 'demo-btc-03', type: 'BUY', date: '2023-01-30', amount: '1.0', price: '19000', fee: '30' },
        { id: 'demo-btc-04', type: 'SELL', date: '2023-08-01', amount: '0.1', price: '30000', fee: '5', isCoinJoin: true },
        { id: 'demo-btc-05', type: 'BUY', date: '2023-09-01', amount: '0.5', price: '26000', fee: '100', isLightning: true },
        // Held past the one year mark, so this one reports as long term.
        { id: 'demo-btc-06', type: 'SELL', date: '2024-03-05', amount: '0.2', price: '42000', fee: '15' },
    ]),
    ETH: Object.freeze([
        { id: 'demo-eth-01', type: 'BUY', date: '2023-01-10', amount: '10.0', price: '1200', fee: '5' },
        { id: 'demo-eth-02', type: 'SELL', date: '2023-05-15', amount: '5.0', price: '1800', fee: '10' },
        { id: 'demo-eth-03', type: 'BUY', date: '2023-06-02', amount: '2.5', price: '1900', fee: '8' },
    ]),
});

export const isDemoKey = (value) => String(value || '').startsWith('DEMO PROFILE');
