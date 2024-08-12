if not SERVER then return end
webluaexec = webluaexec or {}
webluaexec.ip = "192.168.50.50"
webluaexec.port = 8082
include("server/rpc_web.lua")
include("server/rpc_exec.lua")