import { combineReducers } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
import taxReducer from './slices/taxSlice';
import cryptoReducer from './slices/cryptoSlice';

const rootReducer = combineReducers({
    auth: authReducer,
    tax: taxReducer,
    crypto: cryptoReducer,
});

export default rootReducer;
