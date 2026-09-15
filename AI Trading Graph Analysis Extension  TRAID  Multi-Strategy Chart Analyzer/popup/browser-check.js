(function () {
    var ua = navigator.userAgent;
    var isChrome =
        /Chrome\//.test(ua) &&
        !/Edg\//.test(ua) &&
        !/OPR\//.test(ua) &&
        !/YaBrowser\//.test(ua) &&
        !/SamsungBrowser\//.test(ua);

    if (isChrome) return;

    // Block page interaction immediately
    document.documentElement.style.overflow = 'hidden';

    document.addEventListener('DOMContentLoaded', function () {
        var overlay = document.createElement('div');
        overlay.id = 'browser-warning-overlay';
        overlay.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:999999',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'background:#1E222D',
            'padding:24px',
        ].join(';');

        overlay.innerHTML = [
            '<div style="',
                'background:#262B39;',
                'border:1px solid #434651;',
                'border-radius:20px;',
                'padding:40px 32px;',
                'text-align:center;',
                'max-width:340px;',
                'width:100%;',
                'box-shadow:0 20px 60px rgba(0,0,0,0.5);',
            '">',
                '<div style="font-size:56px;margin-bottom:16px;">🌐</div>',
                '<h2 style="',
                    'color:#ECECED;',
                    'font-size:20px;',
                    'font-weight:700;',
                    'margin:0 0 12px;',
                    'font-family:sans-serif;',
                '">Chrome Required</h2>',
                '<p style="',
                    'color:#B2B5BE;',
                    'font-size:14px;',
                    'line-height:1.6;',
                    'margin:0 0 24px;',
                    'font-family:sans-serif;',
                '">',
                    'Traid is built exclusively for <strong style="color:#ECECED;">Google Chrome</strong>.',
                    '<br><br>',
                    'For the best experience and full functionality, please install Traid on Chrome.',
                '</p>',
                '<a href="https://www.google.com/chrome/" target="_blank" style="',
                    'display:inline-block;',
                    'background:linear-gradient(135deg,#26A69A,#2962FF);',
                    'color:#fff;',
                    'text-decoration:none;',
                    'font-family:sans-serif;',
                    'font-size:15px;',
                    'font-weight:700;',
                    'padding:14px 32px;',
                    'border-radius:30px;',
                    'box-shadow:0 8px 24px rgba(38,166,154,0.35);',
                '">Download Google Chrome</a>',
            '</div>',
        ].join('');

        document.body.appendChild(overlay);
    });
})();
