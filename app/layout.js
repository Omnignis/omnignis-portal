import './globals.css';
import CardGlow from '../components/CardGlow';
import MemberFlag from '../components/MemberFlag';

export const metadata = {
  title: 'Omnignis Church Portal',
  description: 'Automated livestream attendance reports for churches.',
  icons: { icon: '/flame.svg' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <CardGlow />
        <MemberFlag />
      </body>
    </html>
  );
}
