from http.server import BaseHTTPRequestHandler
import urllib.parse
import json
import requests
from bs4 import BeautifulSoup
import re

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path)
        query_components = urllib.parse.parse_qs(parsed_path.query)
        url = query_components.get('url', [None])[0]
        
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        if not url:
            self.wfile.write(json.dumps({"error": "URL is required"}).encode('utf-8'))
            return

        try:
            data = self.scrape_netkeiba(url)
            self.wfile.write(json.dumps(data).encode('utf-8'))
        except Exception as e:
            self.wfile.write(json.dumps({"error": "Scraping failed: " + str(e)}).encode('utf-8'))
        return

    def scrape_netkeiba(self, url):
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
        
        res.encoding = 'euc-jp' 
        soup = BeautifulSoup(res.text, 'html.parser')

        race_name_elem = soup.select_one(".RaceName")
        race_name = race_name_elem.text.strip() if race_name_elem else "不明なレース"

        course_info_elem = soup.select_one(".RaceData01")
        course_info = course_info_elem.text.strip().replace('\n', ' ') if course_info_elem else ""
        
        grade_elem = soup.select_one(".RaceData02")
        grade_info = grade_elem.text.replace('\n', ' ').strip() if grade_elem else ""

        date_elem = soup.select_one(".RaceList_DateBox .Active") or soup.select_one("#RaceList_DateList .Active")
        date_info = date_elem.text.strip() if date_elem else ""

        horses = []
        rows = soup.select(".HorseList")
        is_result_page = 'result.html' in url

        for i, row in enumerate(rows):
            try:
                placing = ""
                if is_result_page:
                    rank_elem = row.select_one("td.Result_Num") or row.select_one("td[class*='Result_Num']") or row.select_one("td.Rank")
                    placing = rank_elem.text.strip() if rank_elem else ""

                    umaban_elem = row.select_one("td.Num.Txt_C") or row.select_one("td[class*='Num']")
                    if not umaban_elem: continue
                    try:
                        umaban = int(umaban_elem.text.strip())
                    except ValueError:
                        umaban = i + 1

                    horse_name_elem = row.select_one(".Horse_Info")
                    horse_name = horse_name_elem.text.strip() if horse_name_elem else "不明"

                    odds_elem = row.select_one("td.Odds.Txt_R") or row.select_one("td.Odds")
                    odds_text = odds_elem.text.strip() if odds_elem else "0.0"
                else:
                    umaban_elem = row.select_one("td[class^='Umaban']") or row.select_one("td.Umaban")
                    if not umaban_elem: continue
                    try:
                        umaban = int(umaban_elem.text.strip())
                    except ValueError:
                        umaban = i + 1

                    horse_name_elem = row.select_one(".HorseName a") or row.select_one(".HorseName") or row.select_one(".HorseInfo")
                    horse_name = horse_name_elem.text.strip() if horse_name_elem else "不明"

                    odds_elem = row.select_one("td.Txt_R span") or row.select_one("td.Popular span") or row.select_one("td.Odds span") or row.select_one("td.Txt_R.Popular") or row.select_one("td.Popular") or row.select_one("td.Txt_R")
                    odds_text = odds_elem.text.strip() if odds_elem else "0.0"
                
                try:
                    odds = float(odds_text)
                except ValueError:
                    odds = 0.0

                horses.append({
                    "umaban": umaban,
                    "name": horse_name,
                    "odds": odds,
                    "rank": "B",
                    "placing": placing
                })
            except Exception as e:
                pass

        return {
            "race_name": race_name,
            "course_info": course_info,
            "grade_info": grade_info,
            "date_info": date_info,
            "horses": horses
        }
