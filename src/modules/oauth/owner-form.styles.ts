export const ownerFormStyles = `
  :root {
    color-scheme: dark;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    color: #f2f3fc;
    background: #0c0f1c;
  }

  * { box-sizing: border-box; }
  body {
    min-height: 100vh;
    margin: 0;
    padding: clamp(16px, 5vw, 48px);
    display: grid;
    place-items: center;
    background:
      radial-gradient(ellipse at 16% 8%, #1a1931, transparent 60%),
      radial-gradient(ellipse at 90% 90%, #101a2d, transparent 52%);
  }

  .approval {
    width: min(100%, 480px);
    padding: clamp(24px, 6vw, 40px);
    border: 1px solid #333454;
    border-radius: 24px;
    background: #14182a;
    box-shadow: 0 24px 64px #06081380, 0 4px 12px #06081340;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 24px;
    font-size: 0.875rem;
    font-weight: 700;
  }

  .brand-mark {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 11px;
    color: #fff;
    background: linear-gradient(145deg, #6b53ea, #5630c1);
    font-size: 1.125rem;
  }

  h1 {
    margin: 0;
    font-size: clamp(1.75rem, 5vw, 2.25rem);
    line-height: 1.12;
    letter-spacing: -0.045em;
  }

  .intro {
    margin: 10px 0 24px;
    color: #adb6cf;
    line-height: 1.5;
  }

  .permissions {
    margin-bottom: 24px;
    padding: 16px 18px;
    border: 1px solid #303955;
    border-radius: 14px;
    background: #1a2034;
    font-size: 0.875rem;
  }

  h2 { margin: 0; font-size: inherit; }
  ul {
    margin: 8px 0 0;
    padding-left: 20px;
    color: #bfc8df;
    line-height: 1.6;
  }

  li::marker { color: #b49aff; }
  form { display: grid; gap: 8px; }
  label { font-size: 0.875rem; font-weight: 700; }
  input, button {
    width: 100%;
    min-width: 0;
    min-height: 48px;
    border-radius: 10px;
    font: inherit;
  }

  input {
    padding: 10px 14px;
    border: 1px solid #687396;
    color: inherit;
    background: #0f1323;
  }

  button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin-top: 8px;
    padding: 10px 16px;
    border: 1px solid #917af5;
    color: #fff;
    background: #6346d5;
    font-weight: 700;
    cursor: pointer;
  }

  button:hover { background: #6c50db; }
  :is(input, button):focus-visible {
    outline: 2px solid #bea7ff;
    outline-offset: 3px;
  }
`;
