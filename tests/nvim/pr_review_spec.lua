local t = require("testlib")
local review = require("user.pr_review")

t.eq(133, review.parse_pr('{"number":133}'))
t.eq(nil, review.parse_pr(""))
t.eq(nil, review.parse_pr("not-json"))
t.eq(nil, review.parse_pr('{"number":1.5}'))
t.eq(nil, review.parse_pr('{"number":0}'))
t.eq(nil, review.parse_pr('{"number":-1}'))
