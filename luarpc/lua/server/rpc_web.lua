local web_ip, web_port = webluaexec.ip, webluaexec.port
function webluaexec.sendCallback(uuid, data)
    local inf = {
        uuid = uuid,
        result = data
    }

    HTTP({
        failed = function(err) print(err) end,
        success = function(c, b) if c ~= 200 then return print("Error " .. b) end end,
        method = "POST",
        url = "http://" .. web_ip .. ":" .. web_port .. "/callback", -- Or use without port
        body = util.TableToJSON(inf),
        type = "application/json",
        headers = {}
    })
end

function webluaexec.getLuaData(uuid, cb_lua)
    HTTP({
        failed = function(err) print(err) end,
        success = function(c, b)
            if c ~= 200 then return print("Error " .. b) end
            local data = util.JSONToTable(b)
            cb_lua(data.lua)
        end,
        method = "GET",
        url = "http://" .. web_ip .. ":" .. web_port .. "/luastring/" .. uuid, -- Or use without port
        type = "application/json",
        headers = {}
    })
end