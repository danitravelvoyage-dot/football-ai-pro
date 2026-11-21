package main

import (
	"bytes"
	"fmt"
	"html/template"
	"os"
	"strings"
)

func main() {
	ok := true
	for _, name := range []string{"confirmation", "recovery"} {
		src, err := os.ReadFile(os.Args[1] + "/" + name + ".html")
		if err != nil { panic(err) }
		t, err := template.New(name).Parse(string(src))
		if err != nil { fmt.Println("PARSE FAIL", name, err); os.Exit(1) }
		cases := map[string]map[string]interface{}{"ar": {"locale": "ar"}, "fr": {"locale": "fr"}, "en": {"locale": "en"}, "missing": {}, "nil": nil}
		for label, data := range cases {
			var out bytes.Buffer
			err := t.Execute(&out, map[string]interface{}{"ConfirmationURL": "https://example.test/verify?token=abc&type=signup", "Data": data})
			if err != nil { fmt.Println("EXEC FAIL", name, label, err); ok = false; continue }
			s := out.String()
			n := strings.Count(s, "https://example.test/verify?token=abc&amp;type=signup")
			rtl := strings.Contains(s, `dir="rtl"`)
			fmt.Printf("%s/%s: links=%d rtl=%v fr=%v en=%v\n", name, label, n, rtl, strings.Contains(s, `lang="fr"`), strings.Contains(s, `lang="en"`))
		}
	}
	if !ok { os.Exit(1) }
}
