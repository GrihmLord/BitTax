import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import AuthNavigator from './AuthNavigator';
import { useColorScheme } from 'react-native';

const AppNavigator = () => {
  // Use the device color scheme to apply dark or light theme
  const scheme = useColorScheme();

  // Define a custom theme that extends the default theme
  const customTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: scheme === 'dark' ? '#000' : '#fff',
      // Add other customizations based on light or dark theme
    },
  };

  return (
    <NavigationContainer
      theme={customTheme}
      // Uncomment the following lines if you have set up state persistence and deep linking
      // initialState={initialNavigationState}
      // onStateChange={(state) => AsyncStorage.setItem('NAVIGATION_STATE', JSON.stringify(state))}
      // linking={linkingConfiguration}
    >
      <AuthNavigator />
    </NavigationContainer>
  );
};

export default AppNavigator;
