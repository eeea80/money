document.addEventListener('DOMContentLoaded', () => {
    const backButton = document.getElementById('back-to-main');
    const viewLicenseButton = document.getElementById('viewLicense');
    const contactUsButton = document.getElementById('contactUs');

    if (viewLicenseButton) {
        viewLicenseButton.addEventListener('click', () => {
            window.location.href = 'auth.html';
        });
    }

    if (backButton) {
        backButton.addEventListener('click', () => {
            window.location.href = 'popup.html';
        });
    }

    if (contactUsButton) {
        contactUsButton.addEventListener('click', () => {
            chrome.tabs.create({ url: 'https://inventabot.com/embedemail/traid' });
        });
    }
});
