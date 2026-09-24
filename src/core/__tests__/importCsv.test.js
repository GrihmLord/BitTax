import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCsv, mapColumns, importTransactions, mergeHistories } from '../importCsv.js';
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
    assert.deepEqual(mapColumns(['nothing', 'useful']).missing, ['date', 'type', 'amount', 'price or total']);
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
        + '2023-01-02,Advanced Trade Buy,1,100\n'
        + '2023-01-04,Sold,1,100\n'
        + '2023-01-06,Dispose,1,100\n';

    const { byAsset } = importTransactions(csv);
    assert.deepEqual(byAsset.BTC.map((tx) => tx.type), ['BUY', 'BUY', 'SELL', 'SELL']);
});

/**
 * The previous importer read "Send"/"Withdrawal" as a SELL and
 * "Receive"/"Deposit" as a BUY. Moving coins to your own cold storage is not
 * a disposal: that invented taxable gains and duplicate lots.
 */
test('transfers are skipped and listed, never guessed to be trades', () => {
    const csv = 'date,type,quantity,price\n'
        + '2023-01-01,Buy,1,100\n'
        + '2023-01-02,Send,1,100\n'
        + '2023-01-03,Receive,1,100\n'
        + '2023-01-04,Withdrawal,1,100\n'
        + '2023-01-05,Convert,1,100\n';

    const { byAsset, skipped, errors, imported } = importTransactions(csv);
    assert.equal(imported, 1);
    assert.deepEqual(errors, []);
    assert.deepEqual(skipped.map((entry) => entry.kind), ['TRANSFER', 'TRANSFER', 'TRANSFER', 'SWAP']);
    assert.deepEqual(skipped.map((entry) => entry.line), [3, 4, 5, 6]);
    assert.equal(byAsset.BTC.length, 1);
});

test('income receipts become lots at their market value, and are counted', () => {
    const { byAsset, incomeCount } = importTransactions('date,type,quantity,price\n2023-01-01,Staking Income,0.01,20000\n');
    assert.equal(incomeCount, 1);
    assert.equal(byAsset.BTC[0].type, 'BUY');
    assert.equal(byAsset.BTC[0].isIncome, true);
});

test('a Coinbase-style export with a preamble imports', () => {
    const csv = [
        'You can use this transaction report to inform your likely tax obligations.',
        '',
        'Transactions',
        'User,someone,abc',
        'ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes',
        'a1,2024-01-05T14:03:11Z,Buy,BTC,0.01,USD,$45000.00,$450.00,$455.00,$5.00,Bought',
        'a2,2024-02-05T14:03:11Z,Sell,BTC,-0.005,USD,$50000.00,$250.00,$247.00,$3.00,Sold',
        'a3,2024-03-05T14:03:11Z,Send,BTC,-0.005,USD,$60000.00,,,,To cold storage',
    ].join('\n');

    const { byAsset, skipped, imported, headerLine } = importTransactions(csv);
    assert.equal(headerLine, 5);
    assert.equal(imported, 2);
    assert.equal(skipped.length, 1);
    assert.deepEqual(byAsset.BTC.map((tx) => [tx.id, tx.type, tx.amount, tx.price, tx.fee]), [
        ['a1', 'BUY', '0.01', '45000.00', '5.00'],
        ['a2', 'SELL', '0.005', '50000.00', '3.00'],
    ]);
});

test('a non-USD price is refused rather than read as dollars', () => {
    const { errors } = importTransactions('date,type,amount,price,price currency\n2023-01-01,buy,1,20000,EUR\n');
    assert.match(errors[0], /Line 2: prices are in EUR/);
});

test('a total column is used when there is no unit price', () => {
    const { byAsset } = importTransactions('date,type,amount,subtotal\n2023-01-01,buy,0.3,10000.01\n');
    assert.equal(byAsset.BTC[0].total, '10000.01');
    assert.equal(byAsset.BTC[0].price, undefined);
});

test('every value is validated at import, so one bad row cannot abort the audit', () => {
    const { imported, errors } = importTransactions(
        'date,type,amount,price\n2023-01-01,buy,1,20000\n2023-02-30,buy,1,20000\n2023-01-03,buy,1.123456789,20000\n2023-01-04,buy,1,abc\n',
    );
    assert.equal(imported, 1);
    assert.match(errors[0], /Line 3: .*does not exist/);
    assert.match(errors[1], /Line 4: .*more than 8 decimal places/);
    assert.match(errors[2], /Line 5: .*Malformed decimal/);
});

test('an unterminated quote is reported instead of swallowing the file', () => {
    assert.throws(() => parseCsv('a,b\n1,"oops\n2,3\n'), /Unterminated quoted field starting on line 2/);
});

test('merging a re-import adds nothing, and keeps genuine repeats', () => {
    const first = importTransactions('date,type,amount,price\n2023-01-01,buy,1,100\n2023-01-01,buy,1,100\n').byAsset;
    const again = importTransactions('date,type,amount,price\n2023-01-01,buy,1,100\n2023-01-01,buy,1,100\n2023-02-01,sell,1,120\n').byAsset;

    const { histories, added, duplicates } = mergeHistories(first, again);
    assert.equal(added, 1);
    assert.equal(duplicates, 2);
    assert.equal(histories.BTC.length, 3);
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
        'date,type,amount,price\n2023-01-01,buy,1,20000\n2023-01-02,bogus,1,20000\n2023-01-03,buy,,20000\n',
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
        /Could not find a column for: date, type, amount, price or total/,
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
