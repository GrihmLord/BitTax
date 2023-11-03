import React from 'react';
import { createStackNavigator, TransitionPresets } from '@react-navigation/stack';
import LoginScreen from '../screens/LoginScreen';

const Stack = createStackNavigator();

const AuthNavigator = () => (
  <Stack.Navigator
    screenOptions={{
      headerShown: false, // Hide the header as it's common in auth flows
      ...TransitionPresets.SlideFromRightIOS, // Use iOS-like transitions
      // Add more screen options as needed
    }}
    initialRouteName="Login" // Explicitly set the initial route
  >
    <Stack.Screen name="Login" component={LoginScreen} />
    {/* The HomeScreen is typically not part of the Auth flow, so it's commented out */}
    {/* <Stack.Screen name="Home" component={HomeScreen} /> */}
  </Stack.Navigator>
);

export default AuthNavigator;
