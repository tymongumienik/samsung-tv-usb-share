# USB Share Diagnostic v0.1 dla TizenBrew

Moduł typu `app` dla Samsung TV z Tizen 5.0. Pokazuje stan USB na ekranie TV, uruchamia serwer HTTP na porcie 8080 i udostępnia pliki telefonowi w tej samej sieci. Nie wymaga Expressa ani instalacji zależności npm.

## Drzewo

```text
.
├── package.json
├── service.js
├── app
│   ├── index.html
│   └── app.js
└── README.md
```

## Architektura

1. TizenBrew pobiera `package.json` z jsDelivr dla repozytorium GitHub (`gh/UŻYTKOWNIK/REPO`) i uruchamia `serviceFile` w VM Node. Moduł jest pojedynczym plikiem `service.js`, bo loader pobiera i wykonuje sam skrypt, bez instalowania jego zależności.
2. Node skanuje `/proc/mounts` oraz `/opt/usr/storage`, `/opt/storage`, `/media`, `/mnt`, `/run/media`, `/opt/usr/media`. Tylko rozpoznane zewnętrzne mount pointy są wystawiane do przeglądania. Odczyt używa `fs.createReadStream`.
3. `app/index.html` otwierany na TV używa `tizen.filesystem.listStorages()` i `resolve()`. Wyniki wysyła do usługi HTTP na `127.0.0.1:8080`. Gdy Node nie widzi USB, strona TV może udostępnić pliki przez lokalny most: dla każdego żądania serwer pobiera z Web API tylko 64 KiB, odsyła fragment na telefon i żąda następnego. Odczyt Tizen 5.0 używa `openFile().seek().readData()` z pozycją 64-bitową. TV musi pozostać w module podczas takiego transferu.
4. Telefon otwiera `http://IP_TV:8080/`, a `/debug` pokazuje diagnostykę. Wszystkie żądania mostu są dostępne tylko z `localhost` TV; interfejs plików jest dostępny w LAN bez hasła. Używaj zaufanej sieci.

Pobieranie działa lokalnie **po uruchomieniu modułu**. Obecny TizenBrew pobiera manifest, skrypt usługi i zasoby aplikacji z jsDelivr przy uruchamianiu, więc jego start po całkowitym odłączeniu Internetu nie jest gwarantowany. Transfer działającego modułu nie wymaga Internetu.

## Ważne ograniczenie uprawnień

W aktualnym `config.xml` TizenBrew są uprawnienia `internet` i `unlimitedstorage`, ale nie ma `filesystem.read` ani `externalstorage`. Samsung wymaga `filesystem.read` do `listStorages()` i odczytu Web API, a dostęp do pamięci zewnętrznej może wymagać także `externalstorage`. Moduł npm/GitHub **nie może** dopisać uprawnień do zainstalowanego WGT. Dlatego `v0.1` rozpoznaje faktyczne możliwości danego TV. Jeśli Node ma dostęp do mount pointu, przeglądanie i pobieranie działa bez mostu. Jeśli Node nie ma dostępu, a Web API zgłosi `SecurityError`, trzeba przebudować lub ponownie podpisać TizenBrew z odpowiednimi uprawnieniami; sam moduł tego nie obejdzie. Bez diagnostyki tego egzemplarza nie można uczciwie zagwarantować dostępu USB.

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

## Źródła sprawdzone przy implementacji

- [TizenBrew: format modułu](https://github.com/reisxd/TizenBrew/blob/main/docs/MODULES.md)
- [TizenBrew: loader modułów](https://github.com/reisxd/TizenBrew/blob/main/tizenbrew-app/TizenBrew/service-nextgen/service/utils/moduleLoader.js)
- [TizenBrew: uruchamianie `serviceFile`](https://github.com/reisxd/TizenBrew/blob/main/tizenbrew-app/TizenBrew/service-nextgen/service/utils/serviceLauncher.js)
- [TizenBrew: `config.xml`](https://github.com/reisxd/TizenBrew/blob/main/tizenbrew-app/TizenBrew/config.xml)
- [Samsung: obsługa USB](https://developer.samsung.com/smarttv/develop/guides/data-handling/handling-usb-storages.html)
- [Samsung: Filesystem API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/filesystem-api.html)
