import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateGains, calculatePortfolio, summariseDisposals } from '../gains.js';
import { normaliseHistory } from '../transactions.js';
import { TERM } from '../holdingPeriod.js';

const usd = (dollars) => BigInt(Math.round(dollars * 100));
const run = (history, options = {}) => calculateGains(history, { applyWashSale: true, ...options });
const lotById = (result, id) => result.lots.find((entry) => entry.id === id);

/* --- wash sale: lot granularity ---------------------------------------- */

/**
 * The previous engine spread a wash adjustment across the whole replacement
 * lot. Only the units that replaced the sold position carry it; the rest keep
 * their own basis and their own holding period.
 */
test('a partial replacement is split into its own tranche', () => {
    const result = run([
        { id: 'b1', type: 'BUY', date: '2023-01-01', amount: '1.0', price: '50000' },
        { id: 's1', type: 'SELL', date: '2023-02-01', amount: '1.0', price: '40000' },
        { id: 'b2', type: 'BUY', date: '2023-02-10', amount: '3.0', price: '42000' },
    ]);

    const tranche = lotById(result, 'lot:b2/w1');
    const rest = lotById(result, 'lot:b2');
    assert.ok(tranche, 'the replacement unit is its own tranche');
    assert.equal(tranche.units, 100000000n);
    assert.equal(tranche.basisCents, usd(52000));
    assert.equal(tranche.originId, 'lot:b2', 'coin control state still follows the purchase');
    assert.equal(rest.units, 200000000n);
    assert.equal(rest.basisCents, usd(84000), 'the unmatched units keep their cost exactly');
    assert.equal(rest.holdingStartAt, Date.UTC(2023, 1, 10), 'and their own holding period');
    assert.deepEqual(result.disposals[0].replacementLotIds, ['lot:b2/w1']);
});

test('the tacked holding period excludes the gap between sale and repurchase', () => {
    const result = run([
        { id: 'b1', type: 'BUY', date: '2023-01-01', amount: '1.0', price: '50000' },
        { id: 's1', type: 'SELL', date: '2023-02-01', amount: '1.0', price: '40000' },
        { id: 'b2', type: 'BUY', date: '2023-02-15', amount: '1.0', price: '42000' },
        // 31 days held + b2 from 15 Feb: long term only after 15 Jan 2024.
        { id: 's2', type: 'SELL', date: '2024-01-10', amount: '1.0', price: '60000' },
    ]);

    assert.equal(lotById(result, 'lot:b2').holdingStartAt, Date.UTC(2023, 0, 15));
    const second = result.disposals.find((d) => d.txId === 's2');
    assert.equal(second.term, TERM.SHORT, 'taking the earlier start date would have said LONG');
});

test('other units of the purchase that was sold are not its replacement', () => {
    const result = run([
        { id: 'b1', type: 'BUY', date: '2023-01-20', amount: '2.0', price: '50000' },
        { id: 's1', type: 'SELL', date: '2023-02-01', amount: '1.0', price: '40000' },
    ]);
    assert.equal(result.disposals[0].washSale, false);
    assert.equal(result.disposals[0].gainCents, usd(-10000));
});

test('a purchase already sold before the loss is not held, so it is not a replacement', () => {
    const result = run([
        { id: 'b0', type: 'BUY', date: '2022-01-01', amount: '1.0', price: '50000' },
        { id: 'b1', type: 'BUY', date: '2023-01-10', amount: '1.0', price: '41000' },
        { id: 's0', type: 'SELL', date: '2023-01-12', amount: '1.0', price: '41000' }, // LIFO: consumes b1 at break-even
        { id: 's1', type: 'SELL', date: '2023-02-01', amount: '1.0', price: '40000' }, // b0 at a loss
    ], { method: 'LIFO' });

    const loss = result.disposals.find((d) => d.txId === 's1');
    assert.equal(loss.washSale, false);
    assert.equal(loss.gainCents, usd(-10000));
});

test('a loss on a replacement lot is itself tested, and cascades forward', () => {
    const result = run([
        { id: 'b1', type: 'BUY', date: '2023-01-01', amount: '1.0', price: '50000' },
        { id: 's1', type: 'SELL', date: '2023-02-01', amount: '1.0', price: '40000' },
        { id: 'b2', type: 'BUY', date: '2023-02-05', amount: '1.0', price: '40000' },
        { id: 's2', type: 'SELL', date: '2023-03-01', amount: '1.0', price: '39000' },
        { id: 'b3', type: 'BUY', date: '2023-03-05', amount: '1.0', price: '39000' },
    ]);

    const second = result.disposals.find((d) => d.txId === 's2');
    // b2 basis 40,000 + 10,000 deferred = 50,000; sold for 39,000 -> 11,000 loss, all washed into b3.
    assert.equal(second.basisCents, usd(50000));
    assert.equal(second.disallowedLossCents, usd(11000));
    assert.equal(lotById(result, 'lot:b3').basisCents, usd(50000));
    assert.equal(result.summary.netGainCents, 0n, 'nothing is deducted while a replacement is held');
});

test('HIFO ranks by wash-adjusted basis', () => {
    const result = run([
        { id: 'b1', type: 'BUY', date: '2023-01-01', amount: '1.0', price: '50000' },
        { id: 's1', type: 'SELL', date: '2023-02-01', amount: '1.0', price: '40000' },
        { id: 'b2', type: 'BUY', date: '2023-02-05', amount: '1.0', price: '41000' }, // adjusted to 51,000
        { id: 'b3', type: 'BUY', date: '2023-02-06', amount: '1.0', price: '45000' },
        { id: 's2', type: 'SELL', date: '2023-06-01', amount: '1.0', price: '60000' },
    ], { method: 'HIFO' });

    const second = result.disposals.find((d) => d.txId === 's2');
    assert.equal(second.lotId, 'lot:b2', 'the adjusted 51,000 lot outranks the 45,000 one');
});

/* --- assets ------------------------------------------------------------ */

/**
 * The old engine put every lot in one pool, so an Ethereum sale in a mixed
 * history could consume Bitcoin inventory, and summed satoshi with wei.
 */
test('a history mixing assets is refused rather than pooled', () => {
    assert.throws(() => calculateGains([
        { type: 'BUY', date: '2023-01-01', amount: '1', price: '20000', asset: 'BTC' },
        { type: 'SELL', date: '2023-02-01', amount: '1', price: '1500', asset: 'ETH' },
    ], { asset: 'BTC' }), /Audit each asset separately/);
});

test('calculatePortfolio audits each asset in its own pool', () => {
    const results = calculatePortfolio([
        { type: 'BUY', date: '2023-01-01', amount: '1', price: '20000', asset: 'BTC' },
        { type: 'BUY', date: '2023-01-01', amount: '10', price: '1000', asset: 'ETH' },
        { type: 'SELL', date: '2023-02-01', amount: '5', price: '1500', asset: 'ETH' },
    ]);
    assert.equal(results.BTC.disposals.length, 0);
    assert.equal(results.BTC.openLots[0].units, 100000000n);
    assert.equal(results.ETH.summary.netGainCents, usd(2500));
});

/* --- tax years --------------------------------------------------------- */

test('disposals carry their tax year and are summarised per year', () => {
    const result = run([
        { type: 'BUY', date: '2023-01-01', amount: '2', price: '10000' },
        { type: 'SELL', date: '2023-12-31T23:59:59Z', amount: '1', price: '15000' },
        { type: 'SELL', date: '2024-01-01', amount: '1', price: '20000' },
    ]);
    assert.deepEqual(Object.keys(result.byTaxYear), ['2023', '2024']);
    assert.equal(result.byTaxYear[2023].netGainCents, usd(5000));
    assert.equal(result.byTaxYear[2024].longTermGainCents, 0n, 'held exactly one year: short term');
    assert.equal(result.byTaxYear[2024].shortTermGainCents, usd(10000));
    assert.deepEqual(summariseDisposals(result.disposals.filter((d) => d.taxYear === 2024)), result.byTaxYear[2024]);
});

/* --- transactions ------------------------------------------------------ */

/**
 * Freezes, labels and notes are keyed by transaction id. A positional id moved
 * a label onto a different purchase whenever a row was inserted above it.
 */
test('rows without an id get a stable content-derived id', () => {
    const row = { type: 'BUY', date: '2023-01-01', amount: '1', price: '20000' };
    const other = { type: 'BUY', date: '2022-06-01', amount: '2', price: '30000' };
    const [alone] = normaliseHistory([row], 'BTC');
    const withPrefix = normaliseHistory([other, row], 'BTC').find((tx) => tx.date === '2023-01-01');
    assert.match(alone.id, /^tx-[0-9a-f]{16}$/);
    assert.equal(withPrefix.id, alone.id);

    const twice = normaliseHistory([row, { ...row }], 'BTC');
    assert.equal(twice[1].id, `${twice[0].id}#2`, 'a genuine repeat purchase stays distinct');
});

test('a total is used as the exact consideration, with no price round trip', () => {
    const result = run([
        { type: 'BUY', date: '2023-01-01', amount: '0.3', total: '10000.01' },
        { type: 'SELL', date: '2023-02-01', amount: '0.3', total: '10000.02', fee: '0.01' },
    ]);
    assert.equal(result.lots[0].originalBasisCents, usd(10000.01));
    assert.equal(result.summary.netGainCents, 0n);
});

/* --- scale ------------------------------------------------------------- */

test('a large history is processed in near-linear time', () => {
    const history = [];
    const start = Date.UTC(2015, 0, 1);
    for (let i = 0; i < 20000; i += 1) {
        const day = new Date(start + i * 3600000).toISOString();
        history.push(i % 4 === 3
            ? { type: 'SELL', date: day, amount: '0.01', price: String(20000 + (i % 97) * 10) }
            : { type: 'BUY', date: day, amount: '0.01', price: String(20000 + (i % 89) * 10) });
    }

    for (const method of ['FIFO', 'LIFO', 'HIFO']) {
        const began = performance.now();
        const result = run(history, { method });
        const elapsed = performance.now() - began;
        assert.equal(result.summary.openUnits, 10000n * 1000000n, `${method} conserves units`);
        assert.ok(elapsed < 8000, `${method} took ${Math.round(elapsed)}ms`);
    }
});

/* --- conservation ------------------------------------------------------ */

test('basis is conserved: open + disposed + disallowed accounts for every cent', () => {
    const history = [];
    for (let i = 0; i < 300; i += 1) {
        const date = new Date(Date.UTC(2022, 0, 1) + i * 86400000 * 2).toISOString().slice(0, 10);
        const price = String(30000 + Math.round(8000 * Math.sin(i / 7)));
        history.push({ type: i % 3 === 2 ? 'SELL' : 'BUY', date, amount: '0.37', price, fee: '1.23' });
    }
    for (const method of ['FIFO', 'LIFO', 'HIFO']) {
        const result = run(history, { method });
        const paid = result.transactions
            .filter((tx) => tx.type === 'BUY')
            .reduce((total, tx) => total + tx.grossCents + tx.feeCents, 0n);
        const disposedBasis = result.disposals.reduce((total, d) => total + d.basisCents, 0n);
        const deferred = result.summary.disallowedLossCents;
        assert.equal(disposedBasis + result.summary.openBasisCents, paid + deferred, method);
    }
});
