import { TestBed } from '@angular/core/testing';
import { RealtimeFinto } from '../../testing/fakes';
import { ConnessioneBanner, DURATA_RIPRISTINO_MS } from './connessione-banner';
import { RealtimeService } from './realtime.service';

describe('ConnessioneBanner', () => {
  let realtime: RealtimeFinto;

  beforeEach(() => {
    vi.useFakeTimers();
    realtime = new RealtimeFinto();
    TestBed.configureTestingModule({
      imports: [ConnessioneBanner],
      providers: [{ provide: RealtimeService, useValue: realtime }],
    });
  });

  afterEach(() => vi.useRealTimers());

  function render() {
    const fixture = TestBed.createComponent(ConnessioneBanner);
    TestBed.tick();
    return fixture;
  }
  const testo = (f: ReturnType<typeof render>) => (f.nativeElement as HTMLElement).textContent?.trim() ?? '';

  it('is hidden while connected', () => {
    realtime.stato.set('connesso');
    expect(testo(render())).toBe('');
  });

  it('shows "connection lost" while reconnecting, then "restored" for a moment', () => {
    realtime.stato.set('connesso');
    const f = render();
    realtime.stato.set('riconnessione');
    TestBed.tick();
    expect(testo(f)).toContain('Connessione persa, riprovo…');
    expect(f.nativeElement.querySelector('[role="status"]')).not.toBeNull();

    realtime.stato.set('connesso');
    TestBed.tick();
    expect(testo(f)).toContain('Ripristinato');

    vi.advanceTimersByTime(DURATA_RIPRISTINO_MS + 10);
    TestBed.tick();
    expect(testo(f)).toBe('');
  });

  it('accepts translated texts', () => {
    realtime.stato.set('riconnessione');
    const f = TestBed.createComponent(ConnessioneBanner);
    f.componentRef.setInput('testoPerso', 'Connection lost, retrying…');
    TestBed.tick();
    expect(testo(f)).toContain('Connection lost, retrying…');
  });
});
