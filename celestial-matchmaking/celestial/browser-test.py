import os, json, time
os.environ['LD_LIBRARY_PATH'] = '/tmp/dbg/extract/usr/lib/x86_64-linux-gnu'
from playwright.sync_api import sync_playwright

CHROME = '/home/user/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome'
URL = 'http://127.0.0.1:8080/'
errors, logs = [], []

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME,
        args=['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader',
              '--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width':1440,'height':900})
    pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
    pg.on('pageerror', lambda e: errors.append(str(e)))

    pg.goto(URL, wait_until='networkidle')
    pg.wait_for_timeout(2500)

    print('=== PAGE LOAD ===')
    print('JS errors:', errors if errors else 'none')
    print('webgl context:', pg.evaluate("() => !!document.createElement('canvas').getContext('webgl2')"))
    print('canvas size:', pg.evaluate("() => { const c=document.getElementById('view'); return c ? c.width+'x'+c.height : 'missing'; }"))
    print('login visible:', pg.is_visible('#login'))

    # sign in as Jeriel
    pg.click('.player-btn[data-player="jeriel"]')
    pg.wait_for_timeout(1500)
    print('\n=== AFTER LOGIN ===')
    print('intro visible:', pg.is_visible('#intro'))
    print('intro scene:', pg.evaluate("() => { const s=document.querySelector('#intro .scene:not(.hidden)'); return s ? s.id : 'none'; }"))
    pg.screenshot(path='/home/user/celestial/shot-01-intro-dark.png')

    # let the cinematic advance through the announcer scene
    pg.wait_for_timeout(4500)
    print('scene now:', pg.evaluate("() => { const s=document.querySelector('#intro .scene:not(.hidden)'); return s ? s.id : 'none'; }"))
    pg.screenshot(path='/home/user/shot-02-announcer.png')

    pg.wait_for_timeout(6000)
    print('scene now:', pg.evaluate("() => { const s=document.querySelector('#intro .scene:not(.hidden)'); return s ? s.id : 'none'; }"))
    print('entrance name:', pg.evaluate("() => { const e=document.getElementById('entranceName'); return e ? e.textContent : ''; }"))
    pg.screenshot(path='/home/user/shot-03-entrance.png')

    # skip to the board
    pg.click('#btnSkip')
    pg.wait_for_timeout(2500)
    print('\n=== GAME VIEW ===')
    print('hud visible:', pg.is_visible('#hud'))
    print('intro hidden:', not pg.is_visible('#intro'))
    pg.screenshot(path='/home/user/shot-04-board.png')

    # camera views
    pg.click('#btnCamTop'); pg.wait_for_timeout(1200)
    pg.screenshot(path='/home/user/shot-05-top.png')
    pg.click('#btnCamIso'); pg.wait_for_timeout(2000)
    pg.screenshot(path='/home/user/shot-06-cine.png')

    print('\nJS errors after run:', errors if errors else 'none')
    print('console (last 8):')
    for l in logs[-8:]: print('   ', l[:150])

    b.close()
