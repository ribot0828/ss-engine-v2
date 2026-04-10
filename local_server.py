import http.server
import socketserver
import urllib.parse
import json
import requests
from bs4 import BeautifulSoup
import re

PORT = 8000

class SSEngineHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path)
        
        if parsed_path.path == '/api/scrape':
            query_components = urllib.parse.parse_qs(parsed_path.query)
            url = query_components.get('url', [None])[0]
            
            if not url:
                self._send_response(400, {"error": "URL is required"})
                return

            try:
                data = self.scrape_netkeiba(url)
                self._send_response(200, data)
            except Exception as e:
                self._send_response(500, {"error": str(e)})
            return
            
        return super().do_GET()

    def _send_response(self, status, data):
        self.send_response(status)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def scrape_netkeiba(self, url):
        # Normalize URL to PC version
        match = re.search(r'race_id=(\d+)', url)
        if match:
            race_id = match.group(1)
            page_type = 'result' if 'result' in url else 'shutuba'
            url = f"https://race.netkeiba.com/race/{page_type}.html?race_id={race_id}"

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        res = requests.get(url, headers=headers)
        res.raise_for_status()
        
        # ネット競馬のエンコーディングはEUC-JPであることが多い
        res.encoding = 'euc-jp' 
        soup = BeautifulSoup(res.text, 'html.parser')

        # レース情報の取得
        race_name_elem = soup.select_one(".RaceName")
        race_name = race_name_elem.text.strip() if race_name_elem else "不明なレース"

        course_info_elem = soup.select_one(".RaceData01")
        course_info = course_info_elem.text.strip().replace('\n', ' ') if course_info_elem else ""

        # 馬柱の解析
        horses = []
        rows = soup.select(".HorseList")
        is_result_page = 'result.html' in url

        for row in rows:
            try:
                if is_result_page:
                    umaban_elem = row.select_one("td.Num.Txt_C") or row.select_one("td[class*='Num']")
                    if not umaban_elem:
                        continue
                    umaban = int(umaban_elem.text.strip())

                    horse_name_elem = row.select_one(".Horse_Info")
                    horse_name = horse_name_elem.text.strip() if horse_name_elem else "不明"

                    odds_elem = row.select_one("td.Odds.Txt_R") or row.select_one("td.Odds")
                    odds_text = odds_elem.text.strip() if odds_elem else "0.0"
                else:
                    # 馬番
                    umaban_elem = row.select_one("td[class^='Umaban']") or row.select_one("td.Umaban")
                    if not umaban_elem:
                        continue
                    umaban = int(umaban_elem.text.strip())

                    # 馬名
                    horse_name_elem = row.select_one(".HorseName a") or row.select_one(".HorseName") or row.select_one(".HorseInfo")
                    horse_name = horse_name_elem.text.strip() if horse_name_elem else "不明"

                    # 単勝オッズ
                    odds_elem = row.select_one("td.Txt_R span") or row.select_one("td.Popular span") or row.select_one("td.Odds span") or row.select_one("td.Txt_R.Popular") or row.select_one("td.Popular") or row.select_one("td.Txt_R")
                    odds_text = odds_elem.text.strip() if odds_elem else "0.0"
                
                # オッズが取得できない場合（発売前など）は0.0または"---" になることが多い
                try:
                    odds = float(odds_text)
                except ValueError:
                    odds = 0.0

                horses.append({
                    "umaban": umaban,
                    "name": horse_name,
                    "odds": odds,
                    "rank": "B" # Default rank
                })
            except Exception as e:
                print(f"Error parsing row: {e}")
                continue

        return {
            "race_name": race_name,
            "course_info": course_info,
            "horses": horses
        }

if __name__ == "__main__":
    Handler = SSEngineHandler
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Serving at port {PORT}")
        httpd.serve_forever()
