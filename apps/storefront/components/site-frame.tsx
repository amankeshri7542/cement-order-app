import type { ReactNode } from 'react';
import { readClientConfig, readShop } from '../lib/public-data';
import { AskLauncher } from './ask-launcher';
import { ListBoot } from './list-boot';
import { Footer, Header } from './shell';
import { Vitals } from './vitals';

/** The one frame every page sits in. Server-rendered words, and one small island for the list. */
export async function SiteFrame({ children }: { children: ReactNode }) {
  const [shop, config] = await Promise.all([readShop(), readClientConfig()]);
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Header shop={shop} config={config} />
      <main id="main">{children}</main>
      <Footer shop={shop} config={config} />
      <ListBoot />
      {config.askEnabled ? <AskLauncher /> : null}
      <Vitals />
    </>
  );
}
