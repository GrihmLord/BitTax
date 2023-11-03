import { combineReducers } from 'redux';
import { SET_TAX_DATA, RESET_TAX_DATA, UPDATE_TAX_DATA } from './actionTypes';

// Define initial state for taxReducer
const initialTaxState = {};

const taxReducer = (state = initialTaxState, action) => {
  switch (action.type) {
    case SET_TAX_DATA:
      // Set tax data with the payload
      return { ...action.payload };
    case RESET_TAX_DATA:
      // Reset tax data to initial state
      return initialTaxState;
    case UPDATE_TAX_DATA:
      // Update tax data immutably
      return {
        ...state,
        ...action.payload,
      };
    // Add cases for error handling if necessary
    default:
      // Return the existing state unchanged
      return state;
  }
};

// Combine reducers (add more as your app grows)
const rootReducer = combineReducers({
  taxData: taxReducer,
  // other reducers would go here
});

export default rootReducer;
