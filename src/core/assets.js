/**
 * assets.js
 * Registry of supported assets. Precision lives here and nowhere else, so a
 * new asset never requires touching the calculation engine.
 */

const REGISTRY = Object.freeze({
    BTC: Object.freeze({
        symbol: 'BTC',
        name: 'Bitcoin',
        decimals: 8,
        baseUnit: 'satoshi',
        model: 'utxo',
        displayDecimals: 8,
        color: '#f7931a',
    }),
    ETH: Object.freeze({
        symbol: 'ETH',
        name: 'Ethereum',
        decimals: 18,
        baseUnit: 'wei',
        model: 'account',
        displayDecimals: 6,
        color: '#627eea',
    }),
});

export const SUPPORTED_ASSETS = Object.freeze(Object.keys(REGISTRY));

/**
 * @param {string} symbol
 * @returns {{symbol:string,name:string,decimals:number,baseUnit:string,model:string,displayDecimals:number,color:string}}
 */
export const getAsset = (symbol) => {
    const key = String(symbol || '').toUpperCase();
    const asset = REGISTRY[key];
    if (!asset) {
        throw new RangeError(`Unsupported asset "${symbol}". Supported: ${SUPPORTED_ASSETS.join(', ')}`);
    }
    return asset;
};

export const isSupportedAsset = (symbol) => Object.prototype.hasOwnProperty.call(REGISTRY, String(symbol || '').toUpperCase());
