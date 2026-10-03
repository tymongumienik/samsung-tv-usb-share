# USB Share dla telewizorów Samsung

USB Share udostępnia w sieci lokalnej pliki z pamięci USB podłączonej do telewizora Samsung. Na telefonie otwierasz adres pokazany przez aplikację na TV, przeglądasz katalogi i pobierasz pliki. Projekt powstał dla modelu **UE55RU7172UXXH (Tizen 5.0)**; na tym telewizorze instalacja i działanie zostały potwierdzone przez użytkownika.

## Instalacja z Androida

Potrzebujesz telewizora z włączonym trybem deweloperskim, telefonu z Androidem oraz aplikacji Apps2Samsung. Telefon i TV muszą być w tej samej sieci lokalnej.

1. Pobierz na telefon [USBShare-Tizen5-unsigned.wgt — wydanie v0.2.1](https://github.com/tymongumienik/samsung-tv-usb-share/releases/download/v0.2.1/USBShare-Tizen5-unsigned.wgt).
2. W Apps2Samsung połącz się z telewizorem. Jeśli aplikacja o to poprosi, wpisz **IP telefonu** w ustawieniach trybu deweloperskiego telewizora i uruchom TV ponownie.
3. W Apps2Samsung wybierz **Custom WGT/TPK** lub **Custom WGT File**, wskaż pobrany `.wgt` i naciśnij **Install**. Apps2Samsung podpisuje pakiet certyfikatem właściwym dla telewizora.
4. Uruchom **USB Share** z menu Apps na TV. Otwórz w przeglądarce telefonu adres pokazany na ekranie, zwykle `http://IP_TV:8082/`.

Po instalacji Internet nie jest potrzebny do przesyłania plików. Aplikacja i telefon komunikują się bezpośrednio w LAN. Podczas pobierania pozostaw USB Share otwarte na telewizorze.

## Korzystanie

- Strona główna pokazuje pamięci USB, katalogi, nazwy i rozmiary plików oraz przycisk **Pobierz**.
- Duże pliki są wysyłane strumieniowo. Serwer obsługuje żądania HTTP `Range` i odpowiedzi `206 Partial Content`.
- `http://IP_TV:8082/debug` pokazuje diagnostykę USB, systemu plików, sieci i serwera. Gdy USB nie jest widoczne, skopiuj cały wynik tej strony oraz napisz, czy strona główna otwiera się na telefonie.
- Dostęp do plików jest **tylko do odczytu**. Serwer nie ma hasła, więc używaj aplikacji w zaufanej sieci lokalnej i zamknij ją po zakończeniu transferu.

## Jak działa

Aplikacja TV wykrywa pamięci przez Tizen Filesystem API. Lokalna usługa Node.js sprawdza dostępne punkty montowania i uruchamia serwer HTTP na porcie 8082. Jeśli usługa nie może bezpośrednio czytać USB, aplikacja TV przekazuje jej kolejne fragmenty plików przez lokalny most. Pliki nie są ładowane w całości do RAM. Ścieżki są sprawdzane, aby żądania HTTP nie mogły wyjść poza katalog pamięci USB.

Pakiet `.wgt` zawiera cały kod potrzebny do działania. Nie wymaga usług w chmurze ani pakietów npm.

## Struktura projektu

```text
.
├── config.xml              # manifest aplikacji Tizen 5.0
├── app/
│   ├── index.html          # ekran TV
│   ├── launcher.js         # start lokalnej usługi
│   └── app.js              # wykrywanie USB i most do usługi
├── service/
│   ├── index.js            # punkt wejścia usługi Tizen
│   └── server.js           # HTTP, pliki i diagnostyka
├── scripts/
│   └── build_wgt.py        # budowanie pakietu bez Tizen Studio
└── README.md
```

## Budowanie na Androidzie w Termux

```sh
pkg install git python
git clone https://github.com/tymongumienik/samsung-tv-usb-share.git
cd samsung-tv-usb-share
python scripts/build_wgt.py
```

Wynik znajdziesz w `dist/USBShare-Tizen5-unsigned.wgt`. To pakiet bez podpisu; przed instalacją na TV wskaż go w Apps2Samsung. Skrypt używa wyłącznie standardowej biblioteki Pythona.
