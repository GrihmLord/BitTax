import * as api from '../../utils/api';
import { SET_TAX_DATA, LOGIN_SUCCESS, LOGIN_FAILURE, LOAD_TAX_DATA_BEGIN, LOAD_TAX_DATA_FAILURE } from './actionTypes';

export const setTaxData = (data) => ({
  type: SET_TAX_DATA,
  payload: data,
});

export const login = (username, password) => async (dispatch) => {
  try {
    const userData = await api.loginUser(username, password);
    dispatch({ type: LOGIN_SUCCESS, payload: userData });
  } catch (error) {
    dispatch({ type: LOGIN_FAILURE, error: error.message });
    // Optionally, you could also handle the error by showing a notification, logging it, etc.
  }
};

export const loadTaxData = () => async (dispatch) => {
  dispatch({ type: LOAD_TAX_DATA_BEGIN }); // Dispatch a begin action to set loading state
  try {
    const taxData = await api.fetchTaxData();
    dispatch(setTaxData(taxData));
  } catch (error) {
    dispatch({ type: LOAD_TAX_DATA_FAILURE, error: error.message });
    // Handle the error as needed
  }
};
