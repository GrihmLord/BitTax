import * as api from '../../utils/api';

export const setTaxData = (data) => {
  return {
    type: 'SET_TAX_DATA',
    payload: data,
  };
};

export const login = (username, password) => async (dispatch) => {
  try {
    const userData = await api.loginUser(username, password);
    dispatch({ type: 'LOGIN', payload: userData });
  } catch (error) {
    // Handle error
  }
};

export const loadTaxData = () => async (dispatch) => {
  try {
    const taxData = await api.fetchTaxData();
    dispatch(setTaxData(taxData));
  } catch (error) {
    // Handle error
  }
};
