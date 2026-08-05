import { ScrollViewStyleReset } from 'expo-router/html';

// Expo Router's web output has no root HTML by default, which leaves
// html/body/#root at height:auto — RN's flex:1 containers (and the bottom
// tab bar added for Slate/Best Bets) then can't fill the viewport and just
// render as normal page flow instead of a fixed app-like layout.
// ScrollViewStyleReset applies the standard RN-Web height:100% reset that
// fixes this.
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
