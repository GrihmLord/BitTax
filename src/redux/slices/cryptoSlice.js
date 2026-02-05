import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { fetchBitcoinPrice } from '../../services/BitcoinService';

export const getBitcoinPrice = createAsyncThunk(
    'crypto/getBitcoinPrice',
    async () => {
        const price = await fetchBitcoinPrice();
        return price;
    }
);

const initialState = {
    btcBalance: 0.05, // Starter mock balance
    btcPrice: 0,
    status: 'idle', // idle | loading | succeeded | failed
};

const cryptoSlice = createSlice({
    name: 'crypto',
    initialState,
    reducers: {
        updateBalance: (state, action) => {
            state.btcBalance = action.payload;
        },
        importWallet: (state, action) => {
            const { xpub, addresses } = action.payload;
            state.xpub = xpub;
            state.addresses = addresses;
            // Sum balances
            state.btcBalance = addresses.reduce((acc, addr) => acc + addr.balance, 0);
        },
        withdrawBtc: (state, action) => {
            const amount = action.payload;
            if (state.btcBalance >= amount) {
                state.btcBalance -= amount;
            }
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(getBitcoinPrice.pending, (state) => {
                state.status = 'loading';
            })
            .addCase(getBitcoinPrice.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.btcPrice = action.payload;
            })
            .addCase(getBitcoinPrice.rejected, (state) => {
                state.status = 'failed';
                // Handle error if needed, maybe keep old price
            });
    },
});

export const { updateBalance, withdrawBtc, importWallet } = cryptoSlice.actions;
export default cryptoSlice.reducer;
