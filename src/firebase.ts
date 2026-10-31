import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { getDatabase } from 'firebase/database'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}
export const firebaseReady = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId && config.databaseURL)
const app = firebaseReady ? (getApps().length ? getApp() : initializeApp(config)) : null
export const auth = app ? getAuth(app) : null
export const db = app ? getDatabase(app) : null
export async function ensureIdentity() {
  if (!auth) throw new Error('Add your Firebase settings to .env.local to enable multiplayer.')
  try {
    await auth.authStateReady()
    if (auth.currentUser) return auth.currentUser
    return (await signInAnonymously(auth)).user
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
      throw new Error('Firebase is blocking anonymous account creation. In Firebase Console, enable Authentication → Sign-in method → Anonymous. Also check Authentication → Settings → User actions and allow users to create accounts.')
    }
    if (code === 'auth/unauthorized-domain') {
      throw new Error('This site is not authorized for Firebase sign-in. Add its domain under Firebase Console → Authentication → Settings → Authorized domains.')
    }
    throw error
  }
}
