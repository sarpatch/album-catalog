# Levyhylly – LP-kokoelman hallinta

Selaimessa toimiva, asennettava sovellus (PWA) LP-levykokoelman hallintaan. Toimii kännykällä ja läppärillä, myös ilman verkkoyhteyttä. Tietolähteenä on **CSV-tiedosto**, ja kansikuvat ovat tavallisia JPEG-tiedostoja. Tiedot voi pitää laitteella, omassa kansiossa, **Dropboxissa** tai **Google Drivessa**, ja tallennuspaikkaa voi vaihtaa milloin tahansa.

| Läppäri | Kännykkä |
|---|---|
| ![Läppärinäkymä](docs/desktop.png) | ![Kännykkänäkymä](docs/mobile.png) |

## Ominaisuudet

- **Kansikuvat kameralla tai galleriasta.** Kuvan voi rajata neliöksi (vetämällä, nipistämällä tai liukusäätimellä) ja kiertää. Kuvat pienennetään automaattisesti, ja EXIF-suunta korjataan. Läppärillä kuvan voi myös raahata lomakkeeseen tai liittää leikepöydältä.
- **Haku ja järjestäminen.** Haku toimii kaikista kentistä. Levyjä voi suodattaa genren, formaatin ja kunnon mukaan sekä järjestää artistin (The-sana ohitetaan), nimen, vuoden, lisäysajan tai hyllypaikan mukaan. Näkymänä on ruudukko tai lista.
- **Alan käytännöt.** Kunto arvioidaan [Goldmine-asteikolla](https://www.goldminemag.com/collector-resources/record-grading-101) (M, NM, VG+ … P) erikseen levylle ja kannelle. Kentät ovat Discogs-yhteensopivat: tuotenumero, levy-yhtiö, maa, tyyli ja release ID.
- **Tuonti ja vienti.** Tuetut muodot ovat CSV (pilkku tai puolipiste), oma ZIP-varmuuskopio (CSV + kuvat) ja **Discogsin kokoelmavienti**. Tuonnissa tunnistetaan suomen- ja englanninkieliset sarakenimet. Tuplat huomataan sekä tuonnissa että lisättäessä.
- **Synkronointi.** Sama kokoelma toimii kännykällä ja läppärillä. Muutokset yhdistetään kolmisuuntaisesti, joten myös poistot välittyvät oikein. Käsin (esim. Excelissä) muokattu CSV huomataan, ja tunnisteeton uusi rivi saa automaattisesti id:n.
- **Vaihdettavat teemat.** Valmiina on seitsemän teemaa, automaattinen vaalea/tumma sekä oma teema värivalitsimilla. Uuden teeman voi lisätä muutamalla rivillä.
- **Turvallisuus ja luotettavuus.**
  - Kansikuvat tallentuvat laitteen IndexedDB-muistiin, ja sovellus pyytää selainta säilyttämään tiedot pysyvästi.
  - Poiston voi perua.
  - Jos kokoelmasta ei ole varmuuskopiota, sovellus muistuttaa sen ottamisesta.
  - CSV-viennissä on suojaus kaavainjektiota vastaan.
  - Sivulla on tiukka Content Security Policy, eikä se käytä ulkoisia kirjastoja.
  - Pilvipalveluihin annetaan vain suppeimmat oikeudet (Dropbox: oma sovelluskansio, Google: `drive.file`).
- **Saavutettavuus.** Sovellusta voi käyttää näppäimistöllä: `/` siirtyy hakuun ja `n` lisää uuden levyn. Kosketusalueet ovat vähintään 44 px, ja `prefers-reduced-motion` huomioidaan. Androidin takaisin-painike sulkee auki olevan ikkunan.

## Käyttöönotto

Sovellus on pelkkiä staattisia tiedostoja, eikä se vaadi käännösvaihetta tai palvelinta.

### 1. Julkaisu GitHub Pagesiin

1. Puske repo GitHubiin.
2. Valitse **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Mukana oleva työnkulku (`.github/workflows/pages.yml`) ajaa testit ja julkaisee sovelluksen osoitteeseen `https://<käyttäjä>.github.io/<repo>/`.
4. Avaa osoite kännykällä ja valitse selaimen valikosta **Lisää aloitusnäyttöön** (Android: *Asenna sovellus*). Läppärin Chromessa asennuspainike on osoiterivillä.

Paikallinen kokeilu: `npm start` (tai `python3 -m http.server 8080`) ja selaimella `http://localhost:8080`.

### 2. Dropbox (valinnainen)

1. Avaa [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps) → **Create app**.
2. Valitse *Scoped access* → **App folder**. Anna nimi, esim. `Levyhylly`.
3. Lisää **Permissions**-välilehdellä oikeudet `files.content.write` ja `files.content.read` ja paina *Submit*.
4. Lisää **Settings**-välilehdellä kohtaan *OAuth 2 → Redirect URIs* sovelluksen osoite tarkalleen, esim. `https://kayttaja.github.io/lp-kokoelma/`. Lisää kehitystä varten myös `http://localhost:8080/`.
5. Kopioi **App key**. Liitä se joko sovelluksen *Asetukset → Pilvipalveluiden avaimet* -kohtaan tai pysyvästi tiedostoon `js/config.js`, jolloin sitä ei tarvitse syöttää joka laitteella.
6. Valitse *Asetukset → Tallennuspaikka → Dropbox* ja kirjaudu.

Tiedostot tulevat Dropboxiin kansioon *Sovellukset / Levyhylly / LP-kokoelma*.

### 3. Google Drive (valinnainen)

1. Luo projekti [Google Cloud Consolessa](https://console.cloud.google.com/).
2. Valitse **APIs & Services → Library** ja ota käyttöön **Google Drive API**.
3. Valitse **OAuth consent screen**: *External*, täytä nimi ja sähköposti. Lisää scope `.../auth/drive.file` ja lisää itsesi kohtaan *Test users*.
4. Valitse **Credentials → Create credentials → OAuth client ID → Web application**. Lisää kohtaan *Authorized JavaScript origins* sovelluksen alkuperä, esim. `https://kayttaja.github.io`, sekä `http://localhost:8080`.
5. Kopioi **Client ID** (`…apps.googleusercontent.com`) asetuksiin tai tiedostoon `js/config.js`.
6. Valitse *Asetukset → Tallennuspaikka → Google Drive*.

Tiedostot tulevat Driven juureen kansioon *LP-kokoelma*.

> `drive.file`-oikeuden vuoksi sovellus näkee vain itse luomansa tiedostot. Jos lisäät kuvia kansioon Driven kautta käsin, sovellus ei näe niitä. Lisää kuvat sovelluksen kautta. Googlen istunto kestää tunnin, minkä jälkeen yläpalkkiin tulee *Kirjaudu*-painike.

### 4. Kansio tietokoneella (Chrome/Edge)

Läppärillä voit valita tallennuspaikaksi minkä tahansa kansion. Se voi olla myös Dropboxin, OneDriven tai Google Driven työpöytäsovelluksen synkronoima kansio. Tällöin pilviavaimia ei tarvita lainkaan.

### Tallennuspaikan vaihtaminen

Valitse *Asetukset → Tallennuspaikka* ja napauta uutta paikkaa. Laitteella oleva kokoelma ja kansikuvat kopioidaan uuteen paikkaan. Jos siellä on jo kokoelma (esim. toiselta laitteelta), kokoelmat yhdistetään. Laite pitää aina oman työkopionsa, joten sovellus toimii myös verkotta ja synkronoi, kun yhteys palaa.

## Tiedostomuoto

```
LP-kokoelma/
├── kokoelma.csv          ← tietolähde (UTF-8, pilkkuerotin, RFC 4180)
└── kannet/
    └── <id>-<tunniste>.jpg  (1000 × 1000 px)
```

| Sarake | Sisältö |
|---|---|
| `id` | UUID, pysyvä tunniste. Tyhjä = uusi rivi, sovellus luo tunnisteen. |
| `artist`, `title` | Pakolliset |
| `year`, `label`, `catalog_number`, `country` | Julkaisutiedot |
| `format` | LP, EP, Single, Maxi-single, Boksi, Muu |
| `size`, `speed_rpm`, `discs` | 12"/10"/7", 33/45/78, levyjen määrä |
| `genre`, `style` | Discogs-tyyliin, esim. *Rock* / *Prog Rock* |
| `media_grade`, `sleeve_grade` | Goldmine: M, NM, VG+, VG, G+, G, F, P |
| `barcode`, `discogs_id` | Tunnisteet |
| `location` | Hyllypaikka |
| `purchase_date`, `purchase_price`, `purchase_place` | vvvv-kk-pp, euroa pisteellä (12.50) |
| `notes` | Vapaa teksti, voi sisältää rivinvaihtoja |
| `cover_file` | Suhteellinen polku kansikuvaan |
| `created_at`, `updated_at` | ISO 8601 -aikaleimat. Synkronointi käyttää näitä. |

CSV:tä voi muokata myös Excelissä tai Google Sheetsissä. Muokattu rivi tunnistetaan seuraavassa synkronoinnissa. Mallitiedosto on [`examples/esimerkkikokoelma.csv`](examples/esimerkkikokoelma.csv).

## Teemat

Teeman voi vaihtaa yläpalkin paletti-ikonista tai *Asetuksista*. *Oma teema* tehdään värivalitsimilla suoraan sovelluksessa. Pysyvän uuden teeman saa lisäämällä olion tiedoston [`js/themes.js`](js/themes.js) listaan `THEMES`:

```js
{
  id: 'sinappi', name: 'Sinappi', scheme: 'light',
  colors: { bg: '#fdf6e3', text: '#2d2a24', accent: '#b58900' },
  font: 'serif',   // sans | serif | rounded | condensed | mono
  radius: '10px',
},
```

Pakollisia ovat vain tausta-, teksti- ja korostusväri. Pinnat, reunat ja himmeät tekstit lasketaan niistä automaattisesti, ja korostusvärin päälle valitaan luettava tekstiväri.

## Kehitys

```
index.html            sovelluksen runko
css/app.css           tyylit (mobiili ensin, läppäri ≥ 760 px)
js/app.js             näkymät ja toiminnot
js/model.js           tietomalli, validointi, tuonnin sarakevastaavuudet
js/csv.js             RFC 4180 -jäsennin/kirjoitin
js/merge.js           kolmisuuntainen yhdistäminen
js/sync.js            synkronointi tallennuspaikan kanssa
js/backends/*.js      Dropbox, Google Drive, kansio – yhteinen rajapinta
js/db.js              IndexedDB
js/image.js, cropper.js  kuvankäsittely ja rajaus
js/themes.js          teemat
js/zip.js             ZIP-luku/kirjoitus ilman kirjastoja
sw.js                 offline-välimuisti
tests/                yksikkö- ja synkronointitestit (node --test)
```

```bash
npm test     # Node 20+
npm start    # http://localhost:8080
```

Uuden tallennuspaikan lisääminen tehdään toteuttamalla `js/backends/index.js`:n kuvaama rajapinta (`connect`, `read`, `write`, `remove`, `describe`) ja lisäämällä se listaan `BACKENDS`.

Julkaistessa nosta `VERSION`-arvoa tiedostossa `sw.js`, niin asennetut sovellukset tarjoavat päivitystä.

## Lisenssi

MIT
