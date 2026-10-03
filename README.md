# USB Share dla Tizen 5.0

Samodzielna aplikacja `.wgt` do instalacji przez Apps2Samsung na Androidzie oraz diagnostyczny moduł TizenBrew. Obie wersje pokazują stan USB na ekranie TV i udostępniają pliki telefonowi w tej samej sieci. Nie wymagają Expressa ani innych pakietów npm.

## Instalacja samodzielnej aplikacji przez Apps2Samsung

1. Pobierz na telefonie plik **[USBShare-Tizen5-unsigned.wgt](https://github.com/tymongumienik/tizenbrew-usb-share/releases/download/v0.2.0/USBShare-Tizen5-unsigned.wgt)**. To pakiet bez podpisu; Apps2Samsung podpisze go dla Twojego TV podczas instalacji.
2. W Apps2Samsung na Androidzie wybierz telewizor. Jeśli narzędzie tego wymaga, ustaw w trybie deweloperskim TV adres IP **telefonu**, a potem uruchom TV ponownie. Zaloguj się do konta Samsung w Apps2Samsung, jeśli pojawi się prośba o certyfikat.
3. Wybierz **Custom WGT/TPK** lub **Custom WGT File**, wskaż pobrany plik `.wgt` z folderu Downloads i wybierz **Install**.
4. Otwórz na TV aplikację **USB Share** z menu Apps. Na ekranie pojawi się adres `http://IP_TV:8082`. Wpisz go w przeglądarce telefonu.

Samodzielna aplikacja deklaruje `filesystem.read` i `externalstorage`, których brakuje w obecnym pakiecie TizenBrew. Jej transfer działa w LAN także po odłączeniu Internetu. TV musi pozostać w aplikacji, gdy pliki są odczytywane przez most Web API. Port 8082 pozwala uruchomić ją obok modułu TizenBrew na porcie 8080.

Jeśli instalacja nie powiedzie się, zachowaj dokładny komunikat Apps2Samsung. Jeśli aplikacja się uruchomi, ale USB nie widać, skopiuj cały `http://IP_TV:8082/debug`.

## Drzewo

```text
.
├── package.json
├── service.js
├── app
│   ├── index.html
│   └── app.js
├── standalone
│   ├── config.xml
│   ├── index.html
│   ├── launcher.js
│   └── service.js
├── scripts
│   └── build_wgt.py
└── README.md
```

## Architektura

1. TizenBrew pobiera `package.json` z jsDelivr dla repozytorium GitHub (`gh/UŻYTKOWNIK/REPO`) i uruchamia `serviceFile` w VM Node. Moduł jest pojedynczym plikiem `service.js`, bo loader pobiera i wykonuje sam skrypt, bez instalowania jego zależności.
2. Node skanuje `/proc/mounts` oraz `/opt/usr/storage`, `/opt/storage`, `/opt/media`, `/media`, `/mnt`, `/run/media`, `/opt/usr/media`. Tylko rozpoznane zewnętrzne mount pointy są wystawiane do przeglądania. Odczyt używa `fs.createReadStream`.
3. `app/index.html` otwierany na TV używa `tizen.filesystem.listStorages()` i `resolve()`. Wyniki wysyła do usługi HTTP na `127.0.0.1:8080`. Gdy Node nie widzi USB, strona TV może udostępnić pliki przez lokalny most: dla każdego żądania serwer pobiera z Web API tylko 64 KiB, odsyła fragment na telefon i żąda następnego. Odczyt Tizen 5.0 używa `openFile().seek().readData()` z pozycją 64-bitową. TV musi pozostać w module podczas takiego transferu.
4. Telefon otwiera `http://IP_TV:8080/`, a `/debug` pokazuje diagnostykę. Wszystkie żądania mostu są dostępne tylko z `localhost` TV; interfejs plików jest dostępny w LAN bez hasła. Używaj zaufanej sieci.

Pobieranie działa lokalnie. Obecny TizenBrew pobiera manifest, skrypt usługi i zasoby aplikacji z jsDelivr przy uruchamianiu, więc start *modułu TizenBrew* po całkowitym odłączeniu Internetu nie jest gwarantowany. Samodzielny `.wgt` zawiera wszystkie pliki lokalnie.

## Ważne ograniczenie uprawnień

W aktualnym `config.xml` TizenBrew są uprawnienia `internet` i `unlimitedstorage`, ale nie ma `filesystem.read` ani `externalstorage`. Moduł npm/GitHub **nie może** dopisać uprawnień do zainstalowanego WGT. Samodzielny pakiet deklaruje te uprawnienia, ale rzeczywisty odczyt USB i dostępność serwera LAN muszą zostać potwierdzone na telewizorze. Jeśli Node ma dostęp do mount pointu, przeglądanie i pobieranie działa bez mostu. Jeśli Node nie ma dostępu, aplikacja próbuje Web API. Nie mamy wyniku diagnostyki tego egzemplarza TV.

## Instalacja z Androida

Moduł jest opublikowany w publicznym repozytorium `tymongumienik/tizenbrew-usb-share`. Na Androidzie nie trzeba instalować niczego poza przeglądarką, jeśli TizenBrew już działa na TV.

1. Na TV otwórz **TizenBrew → Module Manager → Add GitHub Repository**.
2. Wpisz dokładnie **`tymongumienik/tizenbrew-usb-share`** (bez `gh/`, bez URL i bez `.git`). TizenBrew dopisze `gh/` sam.
3. Wróć na ekran modułów, odśwież listę lub ponownie uruchom TizenBrew, a potem uruchom **USB Share Diagnostic**.
4. Na ekranie TV odczytaj adres `http://IP_TV:8080`. Otwórz go w przeglądarce Androida. Telefon i TV muszą być w tej samej sieci bez izolacji klientów Wi-Fi.

Opcjonalnie sprawdź publikację w Termux na Androidzie:

```sh
pkg install curl
curl -fL https://cdn.jsdelivr.net/gh/tymongumienik/tizenbrew-usb-share/package.json
```

Pobrany `package.json` powinien zawierać `"packageType": "app"` i `"serviceFile": "service.js"`.

## Użycie i diagnostyka

- Na telefonie `/` pokazuje pamięci, katalogi, rozmiary i przyciski **Pobierz**.
- Pliki są przesyłane porcjami, z `Content-Length`, `Content-Disposition`, MIME i HTTP `Range`/`206`. Żądanie niepoprawnego zakresu otrzymuje `416`.
- Ścieżki względne są sprawdzane przed dostępem. W trybie Node dodatkowo sprawdzany jest `realpath`, aby symlink nie prowadził poza USB.
- Na TV przycisk **Skanuj ponownie** odczytuje Web API; `/debug` na telefonie zwraca pełny JSON.

Jeśli USB nie jest dostępne, skopiuj **całą zawartość** `http://IP_TV:8080/debug`, zwłaszcza pola `server`, `node.nodeVersion`, `node.directories`, `node.mounts`, `tizenService`, `tizenWeb`, `roots`. Dopisz, czy przeglądarka telefonu otwiera stronę główną, oraz czy moduł był otwarty na TV. Nie publikuj prywatnych nazw plików lub adresów IP, jeśli nie chcesz ich ujawniać.

Jeśli port 8080 nie otwiera się, sprawdź na ekranie TV błąd połączenia z usługą i status `serviceFile` w TizenBrew. Moduł próbuje związać port 8080 na wszystkich interfejsach; konflikt portu lub ograniczenie usługi pokaże się w logu TizenBrew.

## Budowanie pakietu `.wgt` w Termux

Źródła można pobrać na Androidzie i zbudować ponownie bez Tizen Studio:

```sh
pkg install git python
git clone https://github.com/tymongumienik/tizenbrew-usb-share.git
cd tizenbrew-usb-share
python scripts/build_wgt.py
```

Wynik jest w `dist/USBShare-Tizen5-unsigned.wgt`. To zwykłe archiwum WGT z `config.xml`, kodem aplikacji, kodem usługi i ikoną. Apps2Samsung musi podpisać je certyfikatem odpowiednim dla TV przed instalacją.

## Źródła sprawdzone przy implementacji

- [TizenBrew: format modułu](https://github.com/reisxd/TizenBrew/blob/main/docs/MODULES.md)
- [TizenBrew: loader modułów](https://github.com/reisxd/TizenBrew/blob/main/tizenbrew-app/TizenBrew/service-nextgen/service/utils/moduleLoader.js)
- [TizenBrew: uruchamianie `serviceFile`](https://github.com/reisxd/TizenBrew/blob/main/tizenbrew-app/TizenBrew/service-nextgen/service/utils/serviceLauncher.js)
- [TizenBrew: `config.xml`](https://github.com/reisxd/TizenBrew/blob/main/tizenbrew-app/TizenBrew/config.xml)
- [Samsung: obsługa USB](https://developer.samsung.com/smarttv/develop/guides/data-handling/handling-usb-storages.html)
- [Samsung: Filesystem API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/filesystem-api.html)
