# BitTax Deep Dive Report

## Executive Summary
BitTax is a React Native mobile application designed to facilitate tax payments via Bitcoin. Currently, the application is in a **prototype phase**. It contains the basic scaffolding for a mobile app but lacks backend connectivity, real state management, and functional business logic.

## Architecture Overview
- **Framework**: React Native with Expo (SDK 49).
- **Navigation**: React Navigation (Stack Navigator).
- **State Management**: Redux is set up (`src/redux/store.js`) but not actively used for app state or authentication in the screens examined.
- **Backend API**: No backend integration is currently implemented. All interactions are simulated with toggles or alerts.
- **Styling**: Standard `StyleSheet` in React Native.

## Component Analysis

### Screens
1.  **LoginScreen** (`src/screens/LoginScreen.js`)
    - **Status**: Visuals only.
    - **Logic**: `handleLogin` checks for empty fields but performs no authentication.
    - **Navigation**: "Forgot Password" and "Sign Up" links exist but likely lead to undefined routes (need to verify `ForgotPassword` and `SignUp` screens capability).

2.  **HomeScreen** (`src/screens/HomeScreen.js`)
    - **Status**: Visuals only.
    - **Visuals**: Displays mock user balance ($2000 Debt, 0.05 BTC).
    - **Logic**: "Pay IRS" and "Withdraw Bitcoin" buttons trigger usage `Alert` dialogs.

3.  **AppNavigator** (`src/navigtaion/AppNavigator.js`)
    - **Status**: Basic wrapper.
    - **Logic**: Wraps `AuthNavigator`. Does not appear to handle switching between Auth/Main stacks (typically done via a token check).

4.  **AuthNavigator** (`src/navigation/AuthNavigator.js`)
    - **Status**: Incomplete.
    - **Logic**: Only defines `LoginScreen`. `HomeScreen` is commented out.

### Missing/Incomplete Features
- **Authentication**: No real auth flow.
- **Data Persistence**: No storage mechanism (AsyncStorage) implemented.
- **API Integration**: No API calls.
- **Web Support**: Configured in scripts, but dependencies (`react-native-web`, `react-dom`) need verification.

## Recommendations for GUI "Deep Dive"
To provide the requested "GUI Format":
1.  **Enable Web**: The app is built with Expo, so it can be served as a web app.
2.  **Mock Flow**: We must simulate the login success to allow navigation to the Main App (Home Screen) for demonstration.
3.  **Route Fixing**: Uncomment `HomeScreen` in `AuthNavigator` or add it to a MainNavigator to allow traversal.

## Visual Design Description (GUI Format)
Since the runtime environment prevented live rendering, here is the design specification based on the code:

### Login Screen
- **Layout**: Vertical stack, centered.
- **Components**:
  - "BitTax" Logo (Text).
  - Input Field: Username.
  - Input Field: Password (obscured).
  - Button: "Log In" (Triggers navigation to Home).
  - Secondary Links: "Forgot Password?", "Sign Up".

### Home Screen
- **Layout**: Vertical stack.
- **Header**: "Welcome, User" (Large text).
- **Dashboard**:
  - "IRS Debt: $2000" (Prominent financial figure).
  - "Bitcoin: 0.05 BTC" (Asset balance).
- **Actions**:
  - Button: "Pay IRS".
  - Button: "Withdraw Bitcoin".
- **Styling**: Light background (`#f5f5f5`), dark text, standard system buttons.
