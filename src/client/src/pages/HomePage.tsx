import InfoToggle from '../components/InfoToggle';

interface HomePageProps {
  onNavigate: (page: 'enter' | 'search' | 'display' | 'account' | 'about' | 'admin') => void;
}

export default function HomePage({ onNavigate }: Readonly<HomePageProps>) {
  return (
    <section>
      <div className="label-with-info" style={{ marginBottom: '16px' }}>
        <h1 style={{ margin: 0 }}>Welcome to Wishboard</h1>
        <InfoToggle>
          <strong>Wishboard</strong> is a disconnected, private bulletin board for conventions. You
          can securely post wishes, search for compatible attendees, or put the device in{' '}
          <strong>Big Screen Display</strong> mode to cycle through wishes like a physical
          corkboard!
        </InfoToggle>
      </div>
      <p>Choose an action below to enter a wish, search wishes, or show the rotating display.</p>
      <div className="home-actions">
        <button type="button" onClick={() => onNavigate('enter')}>
          Enter a Wish
        </button>
        <button type="button" onClick={() => onNavigate('search')}>
          Search Wishes
        </button>
        <button type="button" onClick={() => onNavigate('display')}>
          Big Screen Display
        </button>

        <button type="button" onClick={() => onNavigate('account')}>
          My Account
        </button>
        <button type="button" onClick={() => onNavigate('about')}>
          About Wishboard
        </button>
        <button type="button" onClick={() => onNavigate('admin')}>
          Admin
        </button>
      </div>
    </section>
  );
}
