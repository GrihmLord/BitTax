import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import LoginScreen from './LoginScreen';

describe('LoginScreen', () => {
  it('should not proceed if username or password are empty', () => {
    const { getByPlaceholderText, getByText } = render(<LoginScreen />);

    // Assuming your alert shows 'Both fields are required!'
    const mockAlert = jest.spyOn(window, 'alert').mockImplementation(() => {});

    // Get the button and text inputs
    const loginButton = getByText('Log In');
    const usernameInput = getByPlaceholderText('Username');
    const passwordInput = getByPlaceholderText('Password');

    // Test when both fields are empty
    fireEvent.press(loginButton);
    expect(mockAlert).toHaveBeenCalledWith('Both fields are required!');

    // Test when only username is filled
    fireEvent.changeText(usernameInput, 'user123');
    fireEvent.press(loginButton);
    expect(mockAlert).toHaveBeenCalledWith('Both fields are required!');

    // Test when only password is filled
    fireEvent.changeText(passwordInput, 'password');
    fireEvent.press(loginButton);
    expect(mockAlert).toHaveBeenCalledWith('Both fields are required!');

    mockAlert.mockRestore();
  });
});
