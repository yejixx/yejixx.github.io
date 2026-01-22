import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';


const firebaseConfig = {
    apiKey: "AIzaSyDRYWWUTDY0PKij6dOH1d1ioJ22cYgj9hw",
    authDomain: "cookieclicker-47e02.firebaseapp.com",
    projectId: "cookieclicker-47e02",
    storageBucket: "cookieclicker-47e02.firebasestorage.app",
    messagingSenderId: "968814177318",
    appId: "1:968814177318:web:54db87f402dbf241ddcae7",
    measurementId: "G-3RSEFPM9V0"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {

    // Get DOM elements
    const container = document.getElementById('container');
    const signUpBtn = document.getElementById('signUp');
    const signInBtn = document.getElementById('signIn');
    const authContainer = document.querySelector('.auth-container');
    const gameContainer = document.getElementById('gameContainer');

    // Sign Up elements
    const signUpEmailInput = document.getElementById('signUpEmail');
    const signUpPasswordInput = document.getElementById('signUpPassword');
    const signUpButton = document.getElementById('signUpButton');
    const signUpError = document.getElementById('signUpError');

    // Sign In elements
    const signInEmailInput = document.getElementById('signInEmail');
    const signInPasswordInput = document.getElementById('signInPassword');
    const signInButton = document.getElementById('signInButton');
    const signInError = document.getElementById('signInError');

    // Game elements (optional on this page)
    const signOutButton = document.getElementById('signOutButton');
    const userEmailDisplay = document.getElementById('userEmailDisplay');

        // Add Google Sign-In button handler
    const googleSignInBtn = document.getElementById('googleSignInBtn');
    const googleSignUpBtn = document.getElementById('googleSignUpBtn');

    if (googleSignInBtn) {
        googleSignInBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                const result = await signInWithPopup(auth, googleProvider);
                const user = result.user;
                console.log('Google sign in successful:', user);
                // Redirect will happen automatically via onAuthStateChanged
            } catch (error) {
                console.error('Google sign in error:', error);
                alert(error.message);
            }
        });
    } else {
        console.log('Google button NOT found'); // Add this
    }

    if (googleSignUpBtn) {
        googleSignUpBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                const result = await signInWithPopup(auth, googleProvider);
                const user = result.user;
                console.log('Google sign up successful:', user);
            } catch (error) {
                console.error('Google sign up error:', error);
                alert(error.message);
            }
        });
    }

    // Toggle between sign up and sign in panels (only if elements exist)
    if (signUpBtn && container) {
        signUpBtn.addEventListener('click', () => {
            container.classList.add('right-panel-active');
        });
    }

    if (signInBtn && container) {
        signInBtn.addEventListener('click', () => {
            container.classList.remove('right-panel-active');
        });
    }

    // Handle Sign Up (only if button exists)
    if (signUpButton && signUpEmailInput && signUpPasswordInput && signUpError) {
        signUpButton.addEventListener('click', async (e) => {
            e.preventDefault();
            
            const email = signUpEmailInput.value.trim();
            const password = signUpPasswordInput.value;

            if (!email || !password) {
                showError(signUpError, 'Please fill in all fields');
                return;
            }

            if (password.length < 6) {
                showError(signUpError, 'Password must be at least 6 characters');
                return;
            }

            signUpButton.disabled = true;
            signUpButton.textContent = 'Creating Account...';

            try {
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                console.log('Account created:', userCredential.user);
                signUpEmailInput.value = '';
                signUpPasswordInput.value = '';
                signUpError.classList.remove('show');
            } catch (error) {
                console.error('Sign up error:', error);
                showError(signUpError, error.message);
            } finally {
                signUpButton.disabled = false;
                signUpButton.textContent = 'Sign Up';
            }
        });
    }

    // Handle Sign In (only if button exists)
    if (signInButton && signInEmailInput && signInPasswordInput && signInError) {
        signInButton.addEventListener('click', async (e) => {
            e.preventDefault();
            
            const email = signInEmailInput.value.trim();
            const password = signInPasswordInput.value;

            if (!email || !password) {
                showError(signInError, 'Please fill in all fields');
                return;
            }

            signInButton.disabled = true;
            signInButton.textContent = 'Signing In...';

            try {
                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                console.log('Signed in:', userCredential.user);
                signInEmailInput.value = '';
                signInPasswordInput.value = '';
                signInError.classList.remove('show');
            } catch (error) {
                console.error('Sign in error:', error);
                showError(signInError, error.message);
            } finally {
                signInButton.disabled = false;
                signInButton.textContent = 'Sign In';
            }
        });
    }

    // Handle Sign Out (only if button exists)
    if (signOutButton) {
        signOutButton.addEventListener('click', async () => {
            try {
                await signOut(auth);
                console.log('Signed out');
                window.location.href = "../index.html";
            } catch (error) {
                console.error('Sign out error:', error);
            }
        });
    }

    // Listen for auth state changes
let hasRedirected = false; // Add this flag

const ROUTES = {
    LOGIN: '/index.html',
    GAME: '/cookie-clicker/clicker.html'
};

onAuthStateChanged(auth, (user) => {
    if (user) {
        console.log('User signed in:', user.email);
        
        if (userEmailDisplay) {
            userEmailDisplay.textContent = user.email;
        }
        
        if (window.location.pathname.includes('index.html') && !hasRedirected) {
            hasRedirected = true;
            window.location.href = ROUTES.GAME;
        }
    } else {
        console.log('No user signed in');
        
        if (window.location.pathname.includes('clicker') && !hasRedirected) {
            hasRedirected = true;
            window.location.href = ROUTES.LOGIN;
        }
        
        if (authContainer) authContainer.classList.remove('hide');
        if (gameContainer) gameContainer.classList.remove('show');
    }
});

    // Allow Enter key to submit (only if inputs exist)
    if (signInPasswordInput && signInButton) {
        signInPasswordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                signInButton.click();
            }
        });
    }

    if (signUpPasswordInput && signUpButton) {
        signUpPasswordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                signUpButton.click();
            }
        });
    }

    // Helper function to show errors
    function showError(element, message) {
        if (element) {
            element.textContent = message;
            element.classList.add('show');
            setTimeout(() => {
                element.classList.remove('show');
            }, 5000);
        }
    }

}); // End of DOMContentLoaded
