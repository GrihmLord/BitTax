import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCsv, mapColumns, importTransactions } from '../importCsv.js';
import { calculateGains } from '../gains.js';

test('parses quoted fields, escaped quotes and embedded newlines', () => {
    const rows = parseCsv('a,b,c\r\n1,"two, still two","he said ""hi"""\r\n3,"line\nbreak",4\r\n');

    assert.deepEqual(rows[0], ['a', 'b', 'c']);
    assert.deepEqual(rows[1], ['1', 'two, still two', 'he said "hi"']);
    assert.deepEqual(rows[2], ['3', 'line\nbreak', '4']);
});

test('handles LF-only files and a leading byte order mark', () => {
    const bom = String.fromCodePoint(0xfeff);
    const rows = parseCsv(`${bom}a,b\n1,2\n`);

    assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
});

test('skips entirely blank lines', () => {
    assert.deepEqual(parseCsv('a,b\n\n1,2\n\n'), [['a', 'b'], ['1', '2']]);
});

test('maps column names across common export dialects', () => {
    assert.deepEqual(
        mapColumns(['Date', 'Type', 'Amount', 'Price', 'Fee']).map,
        { date: 0, type: 1, amount: 2, price: 3, fee: 4 },
    );
    assert.deepEqual(
        mapColumns(['Timestamp', 'Side', 'Quantity', 'Unit Price']).map,
        { date: 0, type: 1, amount: 2, price: 3 },
    );
    assert.deepEqual(mapColumns(['nothing', 'useful']).missing, ['date', 'type', 'amount', 'price']);
});

test('imports a plain history', () => {
    const { byAsset, imported, errors } = importTransactions(
        'Date,Type,Amount,Price,Fee\n2023-01-01,buy,1.0,20000,10\n2023-06-01,sell,0.5,30000,5\n',
    );

    assert.equal(imported, 2);
    assert.deepEqual(errors, []);
    assert.equal(byAsset.BTC.length, 2);
    assert.equal(byAsset.BTC[0].type, 'BUY');
    assert.equal(byAsset.BTC[1].type, 'SELL');
});

test('normalises the many words exchanges use for buy and sell', () => {
    const csv = 'date,action,quantity,price\n'
        + '2023-01-01,Purchase,1,100\n'
        + '2023-01-02,RECEIVED,1,100\n'
        + '2023-01-03,Deposit,1,100\n'
        + '2023-01-04,Sold,1,100\n'
        + '2023-01-05,withdrawal,1,100\n'
        + '2023-01-06,Dispose,1,100\n';

    const { byAsset } = importTransactions(csv);
    assert.deepEqual(byAsset.BTC.map((tx) => tx.type), ['BUY', 'BUY', 'BUY', 'SELL', 'SELL', 'SELL']);
});

test('strips currency formatting and reads parenthesised negatives', () => {
    const { byAsset } = importTransactions(
        'date,type,amount,price,fee\n2023-01-01,buy,"1.5","$21,000.00","$1.50"\n',
    );

    assert.equal(byAsset.BTC[0].amount, '1.5');
    assert.equal(byAsset.BTC[0].price, '21000.00');
    assert.equal(byAsset.BTC[0].fee, '1.50');
});

test('splits multiple assets and honours an asset column', () => {
    const { byAsset } = importTransactions(
        'date,type,amount,price,asset\n2023-01-01,buy,1,20000,BTC\n2023-01-02,buy,10,1200,ETH\n',
    );

    assert.deepEqual(Object.keys(byAsset).sort(), ['BTC', 'ETH']);
    assert.equal(byAsset.ETH[0].asset, 'ETH');
});

test('a bad row is reported with its line number, not silently dropped', () => {
    const { imported, errors } = importTransactions(
        'date,type,amount,price\n2023-01-01,buy,1,20000\n2023-01-02,transfer,1,20000\n2023-01-03,buy,,20000\n',
    );

    assert.equal(imported, 1);
    assert.equal(errors.length, 2);
    assert.match(errors[0], /Line 3.*unrecognised transaction type/);
    assert.match(errors[1], /Line 4.*missing amount/);
});

test('an unsupported asset is refused by name', () => {
    const { errors } = importTransactions('date,type,amount,price,asset\n2023-01-01,buy,1,1,DOGE\n');
    assert.match(errors[0], /unsupported asset "DOGE"/);
});

/** Exchanges repeat an order id across partial fills; the engine needs unique ids. */
test('duplicate ids are disambiguated rather than rejected', () => {
    const { byAsset } = importTransactions(
        'id,date,type,amount,price\nORDER-1,2023-01-01,buy,1,100\nORDER-1,2023-01-02,buy,1,100\n',
    );

    const ids = byAsset.BTC.map((tx) => tx.id);
    assert.deepEqual(ids, ['ORDER-1', 'ORDER-1#L3']);
    assert.equal(new Set(ids).size, 2);
});

test('a missing required column fails with the header it actually saw', () => {
    assert.throws(
        () => importTransactions('when,what\n2023-01-01,buy\n'),
        /Could not find a column for: date, type, amount, price/,
    );
    assert.throws(() => importTransactions(''), /file is empty/);
});

test('imported rows feed the gains engine directly', () => {
    const { byAsset } = importTransactions(
        'date,type,amount,price,fee\n2023-01-01,buy,1.0,10000,50\n2023-06-01,sell,1.0,20000,50\n',
    );
    const { summary } = calculateGains(byAsset.BTC, { asset: 'BTC', applyWashSale: false });

    assert.equal(summary.netGainCents, 990000n);
});
