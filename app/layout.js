import './globals.css';

export const metadata = {
  title: 'Omnignis Church Portal',
  description: 'Automated livestream attendance reports for churches.',
  icons: { icon: 'https://omnignis.com/assets/favicon.png' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
