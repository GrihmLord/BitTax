import { combineReducers } from 'redux';

const taxReducer = (state = {}, action) => {
  switch (action.type) {
    case 'SET_TAX_DATA':
      return action.payload;
    case 'RESET_TAX_DATA':
      return {};
    case 'UPDATE_TAX_DATA':
      return {
        ...state,
        ...action.payload
      };
    default:
      return state;
  }
};

const rootReducer = combineReducers({
  taxData: taxReducer,
});

export default rootReducer;
