// Julkaisukohtaiset oletusasetukset. Kun nämä on täytetty, avaimia ei tarvitse
// syöttää jokaisella laitteella erikseen. Arvot eivät ole salaisuuksia –
// selainsovellusten OAuth-tunnisteet ovat aina julkisia (turvallisuus perustuu
// rekisteröityyn paluuosoitteeseen ja PKCE:hen). Ks. README.md.

export const CONFIG = {
  /** Dropboxin App key (dropbox.com/developers/apps) */
  dropboxAppKey: '',
  /** Googlen OAuth 2.0 Client ID (console.cloud.google.com → APIs & Services → Credentials) */
  googleClientId: '',
  /** Kansion nimi pilvessä */
  remoteFolder: 'LP-kokoelma',
};
