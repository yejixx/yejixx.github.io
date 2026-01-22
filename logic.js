// Wait for DOM to load
document.addEventListener('DOMContentLoaded', () => {
    const signUpButton = document.getElementById('signUp');
    const signInButton = document.getElementById('signIn');
    const container = document.getElementById('container');

    // Only add listeners if elements exist
    if (signUpButton && container) {
        signUpButton.addEventListener('click', () => {
            container.classList.add("right-panel-active");
        });
    }

    if (signInButton && container) {
        signInButton.addEventListener('click', () => {
            container.classList.remove("right-panel-active");
        });
    }
});
