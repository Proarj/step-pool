// Register the background sync task before anything renders. On Android the OS
// can start the app headless just to run it, and expo-router only loads route
// files (where the task used to be imported) when it renders.
import './src/lib/background';
import 'expo-router/entry';
