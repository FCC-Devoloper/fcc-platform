
function fccWhenReady(fn) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fn);
    } else {
        fn();
    }
}

// public/js/intro.js

(function () {
  const INTRO_DURATION_MS = 6000;
  const AUDIO_FADE_START_MS = INTRO_DURATION_MS - 1000;
  const PRELOAD_TIMEOUT_MS = 5000;

  const competencies = [
    "WEB3 & CYBER ECOSYSTEMS",
    "HIGH-LOAD BACKEND",
    "TELEGRAM BOTS & WEBSOCKETS",
    "FAST CODING CREW"
  ];

  let introScreen = null;
  let mainContent = null;
  let introAudio = null;
  let orbitWrapper = null;
  let fccLogo = null;
  let textBox = null;
  let textElement = null;
  let startOverlay = null; // <-- Наш оверлей

  let isReady = false;
  let pendingStart = false;
  let isStarted = false;
  let isFinished = false;

  let textInterval = null;
  let textSwapTimeout = null;
  let mainTimer = null;
  let riseTimer = null;
  let fadeTimer = null;

  function waitForAudio(audio) {
    return new Promise(resolve => {
      if (!audio) {
        resolve();
        return;
      }

      if (audio.readyState >= 3) {
        resolve();
        return;
      }

      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;

        audio.removeEventListener('canplaythrough', finish);
        audio.removeEventListener('canplay', finish);
        audio.removeEventListener('error', finish);

        if (audio._fccPreloadTimer) {
          clearTimeout(audio._fccPreloadTimer);
          audio._fccPreloadTimer = null;
        }

        resolve();
      };

      audio.addEventListener('canplaythrough', finish, { once: true });
      audio.addEventListener('canplay', finish, { once: true });
      audio.addEventListener('error', finish, { once: true });

      audio._fccPreloadTimer = setTimeout(finish, PRELOAD_TIMEOUT_MS);
      audio.load();
    });
  }

  async function prepareIntro() {
    try {
      const fontsReady = document.fonts && document.fonts.ready
        ? document.fonts.ready.catch(() => {})
        : Promise.resolve();

      const audioReady = waitForAudio(introAudio);

      await Promise.all([fontsReady, audioReady]);

      // Give the browser two render frames to finish the intro layout.
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);

      isReady = true;

      // If the user clicked while loading, that same click is honoured.
      if (pendingStart && !isStarted && !isFinished) {
        startIntro();
      }
    } catch (error) {
      // The visual intro must never depend on audio/font loading.
      console.warn('[FCC Intro] Preload warning:', error);

      isReady = true;

      if (pendingStart && !isStarted && !isFinished) {
        startIntro();
      }
    }
  }

  function playAudioFromGesture() {
    if (!introAudio) return;

    introAudio.volume = 0.6;

    const promise = introAudio.play();

    if (promise && typeof promise.catch === 'function') {
      promise.catch(error => {
        console.warn('[FCC Intro] Audio playback warning:', error);
      });
    }
  }

  function startCompetencyLoop() {
    if (!textElement || isFinished) return;

    let index = 0;

    textElement.textContent = competencies[index];
    textElement.style.opacity = '1';
    textElement.style.transform = 'translateY(0)';

    textInterval = setInterval(() => {
      if (isFinished) return;

      index = (index + 1) % competencies.length;

      textElement.style.opacity = '0';
      textElement.style.transform = 'translateY(10px)';

      if (textSwapTimeout) {
        clearTimeout(textSwapTimeout);
      }

      textSwapTimeout = setTimeout(() => {
        if (isFinished) return;

        textElement.textContent = competencies[index];
        textElement.style.opacity = '1';
        textElement.style.transform = 'translateY(0)';
      }, 300);
    }, 2000);
  }

  function fadeOutAudio() {
    if (!introAudio || fadeTimer) return;

    fadeTimer = setInterval(() => {
      if (!introAudio || introAudio.paused) {
        clearInterval(fadeTimer);
        fadeTimer = null;
        return;
      }

      introAudio.volume = Math.max(0, introAudio.volume - 0.05);

      if (introAudio.volume <= 0.01) {
        clearInterval(fadeTimer);
        fadeTimer = null;

        introAudio.pause();
        introAudio.currentTime = 0;
        introAudio.volume = 0;
      }
    }, 70);
  }

  function cleanupTimers() {
    if (textInterval) {
      clearInterval(textInterval);
      textInterval = null;
    }

    if (textSwapTimeout) {
      clearTimeout(textSwapTimeout);
      textSwapTimeout = null;
    }

    if (mainTimer) {
      clearTimeout(mainTimer);
      mainTimer = null;
    }

    if (riseTimer) {
      clearTimeout(riseTimer);
      riseTimer = null;
    }

    if (fadeTimer) {
      clearInterval(fadeTimer);
      fadeTimer = null;
    }
  }

  function revealMainContent() {
    if (!mainContent) return;

    mainContent.style.display = 'block';
    mainContent.style.opacity = '0';
    mainContent.style.transition = 'opacity 0.8s ease';

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!mainContent) return;
        mainContent.style.opacity = '1';
      });
    });
  }

  function cleanupAudio() {
    if (!introAudio) return;

    try {
      introAudio.pause();
      introAudio.currentTime = 0;
      introAudio.volume = 0;

      introAudio.removeAttribute('src');
      introAudio.load();
    } catch (error) {
      console.warn('[FCC Intro] Audio cleanup warning:', error);
    }
  }

  function skipAndEnterSite() {
    if (isFinished) return;

    isFinished = true;
    cleanupTimers();

    // Crucial: reveal the site BEFORE removing the intro.
    revealMainContent();

    if (!introScreen) {
      cleanupAudio();
      return;
    }

    introScreen.style.transition =
      'opacity 0.8s ease, visibility 0s linear 0.8s';

    introScreen.style.opacity = '0';
    introScreen.style.visibility = 'hidden';
    introScreen.style.pointerEvents = 'none';

    setTimeout(() => {
      cleanupAudio();

      if (introScreen && introScreen.parentNode) {
        introScreen.remove();
      }

      console.log('🚀 [FCC System] Успешный вход на сайт');
    }, 850);
  }

  function startIntro() {
    if (isFinished) return;

    if (!isStarted) {
      isStarted = true;
      pendingStart = false;

      // 1. Плавно скрываем стартовый оверлей "CLICK ANYWHERE TO START"
      if (startOverlay) {
        startOverlay.classList.add('fade-out');
      }

      // The first click is the browser-approved audio gesture.
      playAudioFromGesture();

      // Start the orbit only now, never during initial page rendering.
      if (orbitWrapper) {
        orbitWrapper.classList.add('animate-orbit');
      }

      // FCC rises after the star has had time to establish the scene.
      riseTimer = setTimeout(() => {
        if (isFinished) return;

        if (fccLogo) {
          fccLogo.classList.add('rise-up');
        }

        if (textBox) {
          textBox.classList.add('visible');
        }

        startCompetencyLoop();
      }, 1200);

      setTimeout(() => {
        if (!isFinished) {
          fadeOutAudio();
        }
      }, AUDIO_FADE_START_MS);

      // Intro duration starts when the cinematic scene actually starts.
      mainTimer = setTimeout(() => {
        skipAndEnterSite();
      }, INTRO_DURATION_MS);

      return;
    }

    // Any later click skips the remaining intro.
    skipAndEnterSite();
  }

  fccWhenReady( () => {
    introScreen = document.getElementById('intro-screen');
    startOverlay = document.getElementById('start-overlay'); // <-- Получаем элемент
    mainContent = document.getElementById('main-content');
    introAudio = document.getElementById('intro-audio');
    orbitWrapper = document.getElementById('orbit-wrapper');
    fccLogo = document.getElementById('fcc-logo-intro');
    textBox = document.querySelector('.intro-text-box');
    textElement = document.getElementById('intro-competency');

    if (introAudio) {
      introAudio.preload = 'auto';
    }

    // ONE click handler only.
    if (introScreen) {
      introScreen.addEventListener('click', () => {
        if (!isReady) {
          pendingStart = true;

          // Preserve the real click as the media gesture.
          playAudioFromGesture();
          return;
        }

        startIntro();
      });
    }

    // Optional keyboard equivalent.
    document.addEventListener('keydown', event => {
      if (event.code !== 'Space' && event.code !== 'Enter') {
        return;
      }

      event.preventDefault();

      if (!isReady) {
        pendingStart = true;
        playAudioFromGesture();
        return;
      }

      startIntro();
    });

    // Start loading everything immediately on page open.
    prepareIntro();
  });
})();