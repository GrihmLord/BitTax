import { createSlice } from '@reduxjs/toolkit';

const initialState = {
    filingStatus: 'single',
    taxableIncome: 0,
    taxDebt: 0,
};

const taxSlice = createSlice({
    name: 'tax',
    initialState,
    reducers: {
        setFilingStatus: (state, action) => {
            state.filingStatus = action.payload;
        },
        setIncome: (state, action) => {
            state.taxableIncome = action.payload;
        },
        updateTaxDebt: (state, action) => {
            state.taxDebt = action.payload;
        },
        payTax: (state, action) => {
            const payment = action.payload;
            if (state.taxDebt >= payment) {
                state.taxDebt -= payment;
            }
        },
    },
});

export const { setFilingStatus, setIncome, updateTaxDebt, payTax } = taxSlice.actions;
export default taxSlice.reducer;
