/**
 * BitcoinService.js
 * Logic for fetching Bitcoin data and simulating transactions.
 */

const COINGECKO_API_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';

export const fetchBitcoinPrice = async () => {
    try {
        const response = await fetch(COINGECKO_API_URL);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const data = await response.json();
        return data.bitcoin.usd;
    } catch (error) {
        console.error('Error fetching Bitcoin price:', error);
        return null;
    }
};

export const convertBtcToUsd = (btcAmount, btcPrice) => {
    return btcAmount * btcPrice;
};

export const convertUsdToBtc = (usdAmount, btcPrice) => {
    return usdAmount / btcPrice;
};
