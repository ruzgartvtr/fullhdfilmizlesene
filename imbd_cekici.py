import json
import re
import time
import requests
from bs4 import BeautifulSoup

# Tarayıcı taklidini güçlendiriyoruz (Daha fazla başlık ekledik)
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Referer": "https://google.com"
}

def slugify(text):
    """Türkçe karakterleri temizler ve arama alias'ı üretir."""
    text = text.replace("İ", "I").replace("ı", "i")
    text = text.replace("Ğ", "G").replace("ğ", "g")
    text = text.replace("Ü", "U").replace("ü", "u")
    text = text.replace("Ş", "S").replace("ş", "s")
    text = text.replace("Ö", "O").replace("ö", "o")
    text = text.replace("Ç", "C").replace("ç", "c")
    text = re.sub(r"[^\w\s]", "", text)
    return text.strip()

title_aliases = {}
page = 1
has_more = True

print("IMDb üzerinden Türk dizileri çekiliyor... Lütfen bekleyin...\n")

# Hacmi artırmak için hem 'tv_series' hem 'tv_mini_series' hem de 'tv_movie' (TV filmleri/programları) taratıyoruz
while has_more:
    start_index = ((page - 1) * 50) + 1
    
    # URL düzeltildi (imdb.com1 hatası giderildi)
    url = f"https://imdb.com{start_index}"

    try:
        # Session kullanarak bağlantıyı canlı tutuyoruz
        with requests.Session() as session:
            response = session.get(url, headers=HEADERS, timeout=20)
            
        if response.status_code == 403:
            print(f"IMDb erişimi engelledi (403 Forbidden). 5 saniye bekleniyor...")
            time.sleep(5)
            continue
            
        if response.status_code != 200:
            print(f"Sayfa {page} alınamadı (Durum Kodu: {response.status_code}).")
            break

        soup = BeautifulSoup(response.text, "html.parser")
        
        # IMDb'nin hem eski hem yeni listeleme sınıflarını kontrol ediyoruz
        items = soup.find_all("li", class_="ipc-metadata-list-summary-item")
        if not items:
            items = soup.find_all("div", class_="lister-item") # Eski tema alternatifi

        if not items:
            print("Taranacak yeni eleman kalmadı veya sayfa yapısı değişti.")
            has_more = False
            break

        for item in items:
            # tt-kodunu çekme
            link_tag = item.find("a", class_="ipc-title-link-wrapper") or item.find("a")
            if not link_tag:
                continue

            href = link_tag.get("href", "")
            match = re.search(r"tt\d+", href)
            if not match:
                continue
            tt_code = match.group(0)

            # Dizi adını çekme
            title_text = item.find("h3", class_="ipc-title__text") or item.find("h3")
            if not title_text:
                continue

            raw_title = title_text.text
            clean_title = re.sub(r"^\d+\.\s+", "", raw_title).strip()

            # İsim varyasyonlarını temizleme
            aliases = [clean_title]
            english_clean = slugify(clean_title)

            if english_clean and english_clean != clean_title:
                aliases.append(english_clean)

            # Çift tırnak ve kaçış karakteri temizliği
            clean_aliases = [a.replace("'", "\\'") for a in aliases if a]
            
            # Benzersiz isimleri kaydet
            title_aliases[tt_code] = list(set(clean_aliases))

        print(f"Sayfa {page} başarıyla tarandı. Toplam kayıt sayısı: {len(title_aliases)}")

        # IMDb tarafından banlanmamak için güvenli bekleme süresi
        time.sleep(2)
        page += 1

        # IMDb'nin listeleme sınırı (Maksimum 50-60 sayfaya kadar izin verir)
        if page > 60:
            break

    except Exception as e:
        print(f"Hata oluştu: {e}")
        break

# JS formatında çıktı oluşturma
output_lines = ["const TİTLE_ALIASES = {"]
for tt_code, aliases_list in title_aliases.items():
    aliases_str = ", ".join([f"'{a}'" for a in aliases_list])
    output_lines.append(f"  {tt_code}: [{aliases_str}],")

if len(output_lines) > 1:
    output_lines[-1] = output_lines[-1].rstrip(",")
output_lines.append("};")

final_output = "\n".join(output_lines)

# Dosyaya yazma
with open("imbdliste.txt", "w", encoding="utf-8") as f:
    f.write(final_output)

print(f"\n[BAŞARILI] {len(title_aliases)} adet Türkçe içerik formatlanarak 'imbdliste.txt' dosyasına kaydedildi.")

