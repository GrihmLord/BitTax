import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import LoginScreen from './LoginScreen';
import { Alert } from 'react-native';

describe('LoginScreen', () => {
  const mockNavigate = jest.fn();

  // Mock the navigation prop
  const mockProps = {
    navigation: {
      navigate: mockNavigate,
    },
  };

  // Mock Alert.alert
  const mockAlert = jest.spyOn(Alert, 'alert');

  beforeEach(() => {
    // Clear all instances and calls to constructor and all methods:
    mockAlert.mockClear();
    mockNavigate.mockClear();
  });

  afterAll(() => {
    mockAlert.mockRestore();
  });

  it('should not proceed if username or password are empty', () => {
    const { getByPlaceholderText, getByText } = render(<LoginScreen {...mockProps} />);

    // Get the button and text inputs
    const loginButton = getByText('Log In');
    const usernameInput = getByPlaceholderText('Username');
    const passwordInput = getByPlaceholderText('Password');

    // Test when both fields are empty
    fireEvent.press(loginButton);
    expect(mockAlert).toHaveBeenCalledWith('Error', 'Both username and password are required!');

    // Test when only username is filled
    fireEvent.changeText(usernameInput, 'user123');
    fireEvent.press(loginButton);
    expect(mockAlert).toHaveBeenCalledWith('Error', 'Both username and password are required!');

    // Clear the username before the next test
    fireEvent.changeText(usernameInput, '');

    // Test when only password is filled
    fireEvent.changeText(passwordInput, 'password');
    fireEvent.press(loginButton);
    expect(mockAlert).toHaveBeenCalledWith('Error', 'Both username and password are required!');

    // Test when both fields are filled
    fireEvent.changeText(usernameInput, 'user123');
    fireEvent.changeText(passwordInput, 'password');
    fireEvent.press(loginButton);
    expect(mockAlert).not.toHaveBeenCalled();
    // If your handleLogin is async, you might want to wait for the promise to resolve
    // await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('NextScreen'));
  });
});
